#!/bin/sh
# cpx-sub-backup — 把 party 容器里的「订阅内容 + 配置状态」备份到宿主机(容器外)。
#
# 为什么需要: 订阅链接会失效(token 被机场轮换/吊销)、订阅项可能在界面里被删掉、
# 容器会重建、数据卷也可能被删 —— 这些都是"内容只剩容器里一份"的单点。
# 备份到宿主机后,上述任何一种情况下内容都还在,可以直接灌回去。
#
# 安装(宿主机, root):
#   install -m 755 sub-backup.sh /usr/local/bin/cpx-sub-backup
#   cat > /etc/cron.d/cpx-sub-backup <<'CRON'
#   */10 * * * * root /usr/local/bin/cpx-sub-backup >/dev/null 2>&1
#   CRON
#
# 规则:
#   - 空内容/占位内容不覆盖已有好备份(订阅被清空时 profile.yaml 只剩 "items: []")
#   - 内容没变不重复存
#   - 每个文件保留最近 20 个历史版本
CT=gateway-party-1
SRC=/data/.config/mihomo-party-dev
DEST=/opt/cpx-sub-backup
TMP=$DEST/.tmp
mkdir -p "$DEST/versions" "$TMP" || exit 1
rm -rf "$TMP"/* 2>/dev/null
# 容器不在(部署/重建期间)就跳过这一轮
docker exec "$CT" true >/dev/null 2>&1 || exit 0
FILES=$(docker exec "$CT" sh -c "ls $SRC/profiles/*.yaml $SRC/config.yaml $SRC/mihomo.yaml $SRC/override.yaml $SRC/profile.yaml 2>/dev/null")
[ -n "$FILES" ] || exit 0
for f in $FILES; do docker cp "$CT:$f" "$TMP/" >/dev/null 2>&1; done
CHANGED=0
for f in "$TMP"/*; do
  [ -e "$f" ] || continue
  b=$(basename "$f")
  [ "$b" = "default.yaml" ] && continue
  sz=$(wc -c < "$f")
  # 小于 200 字节的一律当空:订阅被清空时 profile.yaml 就是 "items: []"(10 字节)
  [ "$sz" -gt 200 ] || continue
  cmp -s "$f" "$DEST/$b" && continue
  cp "$f" "$DEST/$b"
  cp "$f" "$DEST/versions/$b.$(date +%Y%m%d-%H%M%S)"
  echo "$(date '+%F %T') 更新 $b ($sz 字节)" >> "$DEST/backup.log"
  CHANGED=1
done
rm -rf "$TMP"
# 只留最近 20 个历史版本
ls -1t "$DEST"/versions/* 2>/dev/null | tail -n +21 | xargs -r rm -f
[ "$CHANGED" = "1" ] && logger -t cpx-sub-backup "订阅/配置已备份到 $DEST"
exit 0
