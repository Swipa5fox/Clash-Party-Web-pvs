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
import { FaPlus, FaTrash } from 'react-icons/fa6'
import { checkPortOccupied, mihomoProxies } from '@renderer/utils/ipc'

interface Props {
  isOpen: boolean
  onClose: () => void
  groups: ICustomLineGroup[]
  onSave: (groups: ICustomLineGroup[]) => Promise<boolean>
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

// 生成默认草稿
const newDraft = (): Draft => ({
  id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  name: '',
  port: 17890,
  proxies: [],
  testUrl: DEFAULT_TEST_URL,
  interval: 300,
  auto: true,
  fallback: true,
  manual: true,
  global: true,
  enabled: true
})

// 代理名列表弹窗: 多选
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

const CustomLineGroupsModal: React.FC<Props> = ({ isOpen, onClose, groups, onSave }) => {
  const { t } = useTranslation()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [proxies, setProxies] = useState<IMihomoProxy[]>([])
  const [saving, setSaving] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<string | null>(null)
  const [portIssues, setPortIssues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (isOpen) {
      setDrafts(JSON.parse(JSON.stringify(groups)) as Draft[])
      mihomoProxies()
        .then((res) => {
          const list = Object.values(res.proxies).filter(
            (p): p is IMihomoProxy => !('all' in p) && p.name !== 'GLOBAL'
          )
          setProxies(list)
        })
        .catch(() => setProxies([]))
    }
  }, [isOpen, groups])

  const updateDraft = (id: string, patch: Partial<Draft>): void => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  const portConflict = useCallback(
    (draft: Draft): boolean =>
      drafts.some((d) => d.id !== draft.id && d.port === draft.port) ||
      RESERVED_PORTS.includes(draft.port),
    [drafts]
  )

  // 端口占用探测：内核所在本机 + 宿主机地址，命中即返回该草稿的错误文案
  const probePorts = useCallback(async (): Promise<Record<string, string>> => {
    const issues: Record<string, string> = {}
    const hosts = hostHints()
    await Promise.all(
      drafts.map(async (draft) => {
        if (!draft.port || draft.port < 1024 || draft.port > 65535) return
        if (RESERVED_PORTS.includes(draft.port)) return
        // 组间重复由静态校验提示，不必探测
        if (drafts.some((d) => d.id !== draft.id && d.port === draft.port)) return
        // 该组已生效的端口会被它自己的 listener 占着，跳过以免误报
        if (groups.find((g) => g.id === draft.id)?.port === draft.port) return
        try {
          const result = await checkPortOccupied(draft.port, hosts)
          if (result?.occupied) {
            issues[draft.id] =
              result.source === 'remote'
                ? t('customLines.portOccupiedRemote', { host: result.detail ?? '' })
                : t('customLines.portOccupiedLocal')
          }
        } catch {
          // 探测失败不阻塞保存
        }
      })
    )
    return issues
  }, [drafts, groups, t])

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

  const invalid = useMemo(
    () =>
      drafts.some(
        (d) =>
          !d.name.trim() ||
          !d.port ||
          d.port < 1024 ||
          d.port > 65535 ||
          portConflict(d) ||
          d.proxies.length === 0
      ) || Object.keys(portIssues).length > 0,
    [drafts, portConflict, portIssues]
  )

  const doSave = async (): Promise<void> => {
    if (invalid) return
    setSaving(true)
    // 防抖探测可能尚未返回，保存前再确认一次
    const issues = await probePorts()
    setPortIssues(issues)
    if (Object.keys(issues).length > 0) {
      setSaving(false)
      return
    }
    const ok = await onSave(
      drafts.map(
        ({
          id,
          name,
          port,
          proxies,
          testUrl,
          interval,
          auto,
          fallback,
          manual,
          global,
          enabled
        }) => ({
          id,
          name: name.trim(),
          port,
          proxies,
          testUrl: testUrl || DEFAULT_TEST_URL,
          interval,
          auto,
          fallback,
          manual,
          global,
          enabled
        })
      )
    )
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
          <ModalHeader className="flex app-drag">{t('customLines.title')}</ModalHeader>
          <ModalBody className="max-h-[60vh] overflow-y-auto gap-4">
            {drafts.length === 0 && (
              <div className="text-center text-foreground-400 text-sm py-8">
                {t('customLines.empty')}
              </div>
            )}
            {drafts.map((d) => (
              <div key={d.id} className="flex flex-col gap-2 border border-divider rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <Input
                    size="sm"
                    className="flex-1"
                    label={t('customLines.groupName')}
                    value={d.name}
                    onValueChange={(v) => updateDraft(d.id, { name: v })}
                    isInvalid={!d.name.trim()}
                  />
                  <Input
                    size="sm"
                    type="number"
                    className="w-28"
                    label={t('customLines.port')}
                    value={String(d.port)}
                    onValueChange={(v) => updateDraft(d.id, { port: parseInt(v) || 0 })}
                    isInvalid={
                      !d.port ||
                      d.port < 1024 ||
                      d.port > 65535 ||
                      portConflict(d) ||
                      Boolean(portIssues[d.id])
                    }
                  />
                  <Button
                    isIconOnly
                    size="sm"
                    color="danger"
                    variant="light"
                    onPress={() => setDrafts((prev) => prev.filter((x) => x.id !== d.id))}
                  >
                    <FaTrash />
                  </Button>
                </div>
                {portConflict(d) && (
                  <div className="text-danger text-xs">{t('customLines.portConflict')}</div>
                )}
                {portIssues[d.id] && <div className="text-danger text-xs">{portIssues[d.id]}</div>}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm shrink-0">{t('customLines.lines')}</span>
                  <Button
                    size="sm"
                    variant="flat"
                    startContent={<FaPlus />}
                    onPress={() => setPickerTarget(d.id)}
                  >
                    {t('customLines.pickLines')}
                  </Button>
                  <Chip size="sm" variant="flat">
                    {d.proxies.length}
                  </Chip>
                </div>
                {d.proxies.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {d.proxies.map((name) => (
                      <Chip
                        key={name}
                        size="sm"
                        variant="flat"
                        onClose={() =>
                          updateDraft(d.id, {
                            proxies: d.proxies.filter((n) => n !== name)
                          })
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
                        isSelected={Boolean(d[key])}
                        onValueChange={(v) => updateDraft(d.id, { [key]: v } as Partial<Draft>)}
                      >
                        {label}
                      </Switch>
                    </Tooltip>
                  ))}
                </div>
                {d.auto === false &&
                  d.fallback === false &&
                  d.manual === false &&
                  d.global === false && (
                    <div className="text-warning text-xs">{t('customLines.noSubGroup')}</div>
                  )}
                <Divider />
                <div className="flex gap-2">
                  <Input
                    size="sm"
                    className="flex-1"
                    label={t('customLines.testUrl')}
                    value={d.testUrl ?? ''}
                    onValueChange={(v) => updateDraft(d.id, { testUrl: v })}
                  />
                  <Input
                    size="sm"
                    type="number"
                    className="w-28"
                    label={t('customLines.interval')}
                    value={String(d.interval ?? 300)}
                    onValueChange={(v) => updateDraft(d.id, { interval: parseInt(v) || 300 })}
                  />
                </div>
              </div>
            ))}
            <Button
              variant="flat"
              color="primary"
              startContent={<FaPlus />}
              onPress={() => setDrafts((prev) => [...prev, newDraft()])}
            >
              {t('customLines.add')}
            </Button>
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
        isOpen={pickerTarget !== null}
        onClose={() => setPickerTarget(null)}
        proxies={proxies}
        selected={drafts.find((d) => d.id === pickerTarget)?.proxies ?? []}
        title={t('customLines.pickLines')}
        onConfirm={(picked) => {
          if (pickerTarget) updateDraft(pickerTarget, { proxies: picked })
          setPickerTarget(null)
        }}
      />
    </>
  )
}

export default CustomLineGroupsModal
