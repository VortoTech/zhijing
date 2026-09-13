# 部署（<服务器>）

线上地址：`https://zhijing.vortotech.com`（Vorto 阿里云 <服务器 IP>，与冰箱搭子同机）。

## 布局

| 路径 | 用途 |
|---|---|
| `/opt/zhijing-releases/<日期>-<提交>` | 每次发布一个目录，root 所有、只读 |
| `/opt/zhijing` | 指向当前发布的软链接 |
| `/opt/zhijing-runtime/current` | 独立 Node 22 运行时，不影响同机其他项目 |
| `/etc/zhijing/zhijing.env` | 凭据与配置，`600`，属主 `zhijing`。只在服务器上，不进仓库 |
| `/etc/systemd/system/zhijing.service` | 以 `zhijing` 用户运行，监听 `127.0.0.1:4320` |
| `/etc/nginx/conf.d/zhijing.vortotech.com.conf` | 反向代理；`/api/reading-map` 每 IP 20 次/分钟 |
| `/var/log/zhijing.log` | 服务日志（已脱敏，不含凭据、正文、评论） |

线上配置与本地 `.env.local` 相同，另外固定 `PORT=4320`、`HOST=127.0.0.1`、`ZHIJING_ENABLE_PILOT=1`、`ZHIJING_LIVE_DAILY_LIMIT=200`。

## 发布新版本

先在本机确认 `npm run check && npm test` 退出码为 0 再打包。不要用 `npm test | grep …` 的结果判断：管道的退出码是 grep 的，测试失败也会被当成成功（9/13 因此带着 2 个失败的测试发布过一次）。

```sh
# 本机
git archive --format=tar.gz -o /tmp/zhijing-$(git rev-parse --short HEAD).tar.gz HEAD
scp /tmp/zhijing-<提交>.tar.gz <服务器>:/root/

# 服务器
REL=/opt/zhijing-releases/$(date +%Y%m%d)-<提交>
mkdir -p $REL && tar -xzf /root/zhijing-<提交>.tar.gz -C $REL && chmod -R a+rX $REL
ln -sfn $REL /opt/zhijing && systemctl restart zhijing
curl -s 127.0.0.1:4320/api/health
```

回滚：把 `/opt/zhijing` 指回上一个发布目录，再 `systemctl restart zhijing`。

## 验收

```sh
cd /opt/zhijing
ZHIJING_BASE_URL=http://127.0.0.1:4320 /opt/zhijing-runtime/current/bin/node scripts/smoke.mjs --live
```

会实际消耗检索与模型额度。退出码 2 表示有部分结果（例如 1 条引文校验未通过），不是服务故障。

## HTTPS

DNS（`zhijing` A 记录 → <服务器 IP>）生效后：

```sh
certbot --nginx -d zhijing.vortotech.com
```

## 修改配置

编辑 `/etc/zhijing/zhijing.env` 后 `systemctl restart zhijing`。不要把其中的值贴到聊天、日志、截图或视频里。
