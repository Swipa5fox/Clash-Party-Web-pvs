import {
  Button,
  Chip,
  Divider,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
  Tooltip
} from '@heroui/react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FaPlus } from 'react-icons/fa6'
import { checkPortOccupied, mihomoProxies } from '@renderer/utils/ipc'
import { BUILTIN_POLICIES } from '../../../../shared/customLineGroups'

interface Props {
  isOpen: boolean
  onClose: () => void
  groups: ICustomLineGroup[]
  onSave: (groups: ICustomLineGroup[]) => Promise<boolean>
  // 编辑模式: 只展示并保存该组(单卡, 不附加空白草稿); 新增走不带此参数的入口
  editGroupId?: string | null
}

type Draft = ICustomLineGroup

const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204'

// 内核/面板固定占用的端口，直接判冲突
const RESERVED_PORTS = [7890, 7891, 7892, 7893, 9090]

// 宿主机地址提示：web 模式下 location.hostname 即网关宿主机 IP，
// 用于探测 bridge 网络下宿主机(容器外)的端口占用
const hostHints = (): string[] => {
  const hostname = typeof window === 'undefined' ? '' : window.location?.hostname
  return hostname ? [hostname] : []
}

// 生成默认草稿: 端口不预填, 由用户自定(0 = 未填)
const newDraft = (): Draft => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  name: '',
  port: 0,
  proxies: [],
  testUrl: DEFAULT_TEST_URL,
  interval: 300,
  auto: true,
  fallback: true,
  manual: true,
  global: true,
  enabled: true
})

// 代理选择弹窗: 当前订阅全部节点平铺多选(广告/信息节点剔除)
const ProxyPicker: React.FC<{
  isOpen: boolean
  onClose: () => void
  proxies: IMihomoProxy[]
  selected: string[]
  title: string
  onConfirm: (selected: string[]) => void
}> = ({ isOpen, onClose, proxies, selected, title, onConfirm }) => {
  const { t } = useTranslation()
  const [local, setLocal] = useState<string[]>(selected)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (isOpen) {
      setLocal(selected)
      setSearch('')
    }
  }, [isOpen, selected])

  const filtered = useMemo(() => {
    if (!search) return proxies
    return proxies.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
  }, [proxies, search])

  const toggle = (name: string): void => {
    setLocal((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  return (
    <Modal
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]' }}
      isOpen={isOpen}
      onOpenChange={(open) => !open && onClose()}
      size="lg"
    >
      <ModalContent>
        <ModalHeader className="flex app-drag">{title}</ModalHeader>
        <ModalBody className="max-h-[60vh] overflow-y-auto">
          <Input
            size="sm"
            placeholder={t('customLines.searchProxy')}
            value={search}
            onValueChange={setSearch}
          />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
            {filtered.map((p) => {
              const isSelected = local.includes(p.name)
              return (
                <div
                  key={p.name}
                  className={`cursor-pointer rounded-md border border-divider px-2 py-1 text-sm truncate ${
                    isSelected ? 'bg-primary/30 border-primary' : 'bg-content2'
                  }`}
                  onClick={() => toggle(p.name)}
                  title={p.name}
                >
                  <span className="flag-emoji">{p.name}</span>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="col-span-full text-center text-foreground-400 text-sm py-4">
                {t('customLines.noProxies')}
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" color="primary" onPress={() => onConfirm(local)}>
            {t('common.confirm')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

const CustomLineGroupsModal: React.FC<Props> = ({
  isOpen,
  onClose,
  groups,
  onSave,
  editGroupId
}) => {
  const { t } = useTranslation()
  const isEdit = Boolean(editGroupId)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [proxies, setProxies] = useState<IMihomoProxy[]>([])
  const [saving, setSaving] = useState(false)
  const [pickerTarget, setPickerTarget] = useState(false)
  const [portIssues, setPortIssues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (isOpen) {
      // 单卡: 编辑带出目标组, 新增给一张空白草稿; 保存都对照全量 groups
      const target = editGroupId ? groups.find((g) => g.id === editGroupId) : undefined
      setDraft(target ? structuredClone(target) : newDraft())
      mihomoProxies()
        .then((res) => {
          // 平铺当前订阅全部节点; 过滤组/内建策略/ad-filter 覆写注入的 COMPATIBLE 兜底
          const list = Object.values(res.proxies).filter(
            (p): p is IMihomoProxy => !('all' in p) && !BUILTIN_POLICIES.has(p.name)
          )
          setProxies(list)
        })
        .catch(() => setProxies([]))
    }
  }, [isOpen, groups, editGroupId])

  const updateDraft = (patch: Partial<Draft>): void => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  // 组间重复/保留端口判定; 未填(0)由 invalid 提示, 不算冲突
  const portConflict = useCallback(
    (d: Draft): boolean =>
      d.port !== 0 &&
      (RESERVED_PORTS.includes(d.port) || groups.some((g) => g.id !== d.id && g.port === d.port)),
    [groups]
  )

  // 端口占用探测：内核所在本机 + 宿主机地址，命中即返回错误文案
  const probePorts = useCallback(async (): Promise<Record<string, string>> => {
    if (!draft) return {}
    const issues: Record<string, string> = {}
    const hosts = hostHints()
    const d = draft
    if (d.port && d.port >= 1024 && d.port <= 65535 && !RESERVED_PORTS.includes(d.port)) {
      // 与其它组重复由静态校验提示，不必探测
      const dup = groups.some((g) => g.id !== d.id && g.port === d.port)
      // 该组已生效的端口会被它自己的 listener 占着，跳过以免误报(仅编辑命中)
      const own = groups.find((g) => g.id === d.id)?.port === d.port
      if (!dup && !own) {
        try {
          const result = await checkPortOccupied(d.port, hosts)
          if (result?.occupied) {
            issues[d.id] =
              result.source === 'remote'
                ? t('customLines.portOccupiedRemote', { host: result.detail ?? '' })
                : t('customLines.portOccupiedLocal')
          }
        } catch {
          // 探测失败不阻塞保存
        }
      }
    }
    return issues
  }, [draft, groups, t])

  // 端口改动后防抖探测一次，实时给出冲突提示
  useEffect(() => {
    if (!isOpen) {
      setPortIssues({})
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void probePorts().then((issues) => {
        if (!cancelled) setPortIssues(issues)
      })
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [isOpen, probePorts])

  // 空草稿判定: 新增时啥都没填 → 保存等于取消, 不落盘直接关
  const isBlank = (d: Draft): boolean => !d.name.trim() && !d.port && d.proxies.length === 0

  const invalid = useMemo(
    () =>
      !draft ||
      (!isBlank(draft) &&
        (!draft.name.trim() ||
          !draft.port ||
          draft.port < 1024 ||
          draft.port > 65535 ||
          portConflict(draft) ||
          draft.proxies.length === 0)) ||
      Object.keys(portIssues).length > 0,
    [draft, portConflict, portIssues]
  )

  const doSave = async (): Promise<void> => {
    if (!draft || invalid) return
    setSaving(true)
    // 防抖探测可能尚未返回，保存前再确认一次
    const issues = await probePorts()
    setPortIssues(issues)
    if (Object.keys(issues).length > 0) {
      setSaving(false)
      return
    }
    if (isBlank(draft)) {
      // 空草稿 = 什么都没加, 不落盘直接关
      setSaving(false)
      onClose()
      return
    }
    const clean: ICustomLineGroup = {
      ...draft,
      name: draft.name.trim(),
      testUrl: draft.testUrl || DEFAULT_TEST_URL
    }
    // 编辑: 按id替换回全量; 新增: 追加到全量尾部
    const next = isEdit ? groups.map((g) => (g.id === clean.id ? clean : g)) : [...groups, clean]
    const ok = await onSave(next)
    setSaving(false)
    if (ok) onClose()
  }

  return (
    <>
      <Modal
        backdrop="blur"
        classNames={{ backdrop: 'top-[48px]' }}
        isOpen={isOpen}
        hideCloseButton
        onOpenChange={(open) => !open && onClose()}
        size="lg"
      >
        <ModalContent>
          <ModalHeader className="flex app-drag">
            {isEdit ? t('customLines.editTitle') : t('customLines.addTitle')}
          </ModalHeader>
          <ModalBody className="max-h-[60vh] overflow-y-auto gap-4">
            {draft && (
              <div className="flex flex-col gap-2 border border-divider rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <Input
                    size="sm"
                    className="flex-1"
                    label={t('customLines.groupName')}
                    value={draft.name}
                    onValueChange={(v) => updateDraft({ name: v })}
                    isInvalid={!draft.name.trim() && !isBlank(draft)}
                  />
                  <Input
                    size="sm"
                    type="number"
                    className="w-28"
                    label={t('customLines.port')}
                    value={draft.port ? String(draft.port) : ''}
                    onValueChange={(v) => updateDraft({ port: parseInt(v) || 0 })}
                    isInvalid={
                      (!draft.port && !isBlank(draft)) ||
                      draft.port < 1024 ||
                      draft.port > 65535 ||
                      portConflict(draft) ||
                      Boolean(portIssues[draft.id])
                    }
                  />
                </div>
                {portConflict(draft) && (
                  <div className="text-danger text-xs">{t('customLines.portConflict')}</div>
                )}
                {portIssues[draft.id] && (
                  <div className="text-danger text-xs">{portIssues[draft.id]}</div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm shrink-0">{t('customLines.lines')}</span>
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={<FaPlus />}
                    onPress={() => setPickerTarget(true)}
                  >
                    {t('customLines.pickLines')}
                  </Button>
                  <Chip size="sm" variant="flat">
                    {draft.proxies.length}
                  </Chip>
                </div>
                {draft.proxies.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {draft.proxies.map((name) => (
                      <Chip
                        key={name}
                        size="sm"
                        variant="flat"
                        onClose={() =>
                          updateDraft({ proxies: draft.proxies.filter((n) => n !== name) })
                        }
                      >
                        <span className="flag-emoji">{name}</span>
                      </Chip>
                    ))}
                  </div>
                )}
                <Divider />
                <div className="flex flex-wrap gap-4">
                  {(
                    [
                      ['auto', t('customLines.auto')],
                      ['fallback', t('customLines.fallback')],
                      ['manual', t('customLines.manual')],
                      ['global', t('customLines.global')]
                    ] as [keyof Draft, string][]
                  ).map(([key, label]) => (
                    <Tooltip
                      key={String(key)}
                      content={t(`customLines.${String(key)}Tip`)}
                      placement="bottom"
                    >
                      <Switch
                        size="sm"
                        isSelected={Boolean(draft[key])}
                        onValueChange={(v) => updateDraft({ [key]: v } as Partial<Draft>)}
                      >
                        {label}
                      </Switch>
                    </Tooltip>
                  ))}
                </div>
                {draft.auto === false &&
                  draft.fallback === false &&
                  draft.manual === false &&
                  draft.global === false && (
                    <div className="text-warning text-xs">{t('customLines.noSubGroup')}</div>
                  )}
                <Divider />
                <div className="flex gap-2">
                  <Input
                    size="sm"
                    className="flex-1"
                    label={t('customLines.testUrl')}
                    value={draft.testUrl ?? ''}
                    onValueChange={(v) => updateDraft({ testUrl: v })}
                  />
                  <Input
                    size="sm"
                    type="number"
                    className="w-28"
                    label={t('customLines.interval')}
                    value={String(draft.interval ?? 300)}
                    onValueChange={(v) => updateDraft({ interval: parseInt(v) || 300 })}
                  />
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={onClose}>
              {t('common.cancel')}
            </Button>
            <Button color="primary" isDisabled={invalid} isLoading={saving} onPress={doSave}>
              {t('common.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <ProxyPicker
        isOpen={pickerTarget}
        onClose={() => setPickerTarget(false)}
        proxies={proxies}
        selected={draft?.proxies ?? []}
        title={t('customLines.pickLines')}
        onConfirm={(picked) => {
          updateDraft({ proxies: picked })
          setPickerTarget(false)
        }}
      />
    </>
  )
}

export default CustomLineGroupsModal
