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
| `/etc/nginx/conf.d/zhijing.vortotech.com.conf` | 反向代理；`/api/reading-map` 每 IP 20 次/分钟；`/api/advice`、`/api/profile/infer` 每 IP 12 次/分钟 |
| PostgreSQL 13（同机已有实例，只听本机） | 独立的库 `zhijing`、同名角色；知镜以系统用户 `zhijing` 经 socket 登录（peer 认证，无密码），没有改动共享的 `pg_hba.conf` |
| `/var/log/zhijing.log` | 服务日志（已脱敏，不含凭据、正文、评论） |

线上配置与本地 `.env.local` 相同，另外固定 `PORT=4320`、`HOST=127.0.0.1`、`ZHIJING_ENABLE_PILOT=1`、`ZHIJING_LIVE_DAILY_LIMIT=400`、`DATABASE_URL=postgresql://zhijing@%2Fvar%2Frun%2Fpostgresql/zhijing`。可选 `ZHIJING_ADVICE_DAILY_LIMIT`（决策陪伴每日次数，默认 600）。另有 `AI_FALLBACK_MODEL=qwen-plus`：主模型上游卡住时自动改用它（线上已配，9/15 凌晨 deepseek 上游出现过几分钟整段超时）。

## 发布新版本

先在本机确认 `npm run check && npm test` 退出码为 0 再打包。不要用 `npm test | grep …` 的结果判断：管道的退出码是 grep 的，测试失败也会被当成成功（9/13 因此带着 2 个失败的测试发布过一次）。

唯一的依赖是 `pg`（纯 JS），在本机装进发布包，服务器不用联网安装：

```sh
# 本机
REV=$(git rev-parse --short HEAD); B=$(mktemp -d)
git archive HEAD | tar -x -C $B && (cd $B && npm ci --omit=dev --ignore-scripts)
# macOS 的 tar 会把扩展属性打成 ._* 文件，topics/ 里多出 ._x.json 会让服务启动失败（9/14 出过一次）
COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/zhijing-$REV.tar.gz -C $B .
tar -tzf /tmp/zhijing-$REV.tar.gz | grep -c '/\._' && echo '有 ._ 文件，别发布'
scp /tmp/zhijing-$REV.tar.gz <服务器>:/root/

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

## 启用知乎登录

1. 在赛事页面创建项目，领取 App ID 与 App Key；知乎登录回调地址登记为 `https://zhijing.vortotech.com/auth/callback`（与配置逐字一致，无尾部斜杠）。
2. 在本机 `.env.local` 填 `ZHIHU_OAUTH_APP_ID`、`ZHIHU_OAUTH_APP_KEY`、`ZHIHU_OAUTH_REDIRECT_URI`，不要贴到聊天里。
3. 只把这三行同步到服务器 `/etc/zhijing/zhijing.env`（不打印值），`systemctl restart zhijing`。
4. 用自己的知乎账号在公网实际走一遍登录、退出；确认 `/api/me` 返回昵称，浏览器、日志里没有 App Key 和 token。

## 用户信息存储（PostgreSQL）

首次启用（已完成，记录备查）：

```sh
sudo -u postgres psql -c "create role zhijing login"
sudo -u postgres psql -c "create database zhijing owner zhijing"
sudo -u zhijing psql -h /var/run/postgresql -d zhijing -c "select current_user"   # 验证 peer 认证
# /etc/zhijing/zhijing.env 追加 DATABASE_URL（见上），重启服务
```

表结构在服务启动时自动建立（`src/store.mjs` 的 `SCHEMA`，只用 `create … if not exists`）。存什么、不存什么：

| 表 | 内容 | 保留 |
|---|---|---|
| `users` | 知乎昵称、签名、头像，是否开启「记住我的情况」 | 用户删除为止 |
| `sessions` | 会话号的 SHA-256、会话里的昵称头像 | 7 天 |
| `profile_facts` | 用户确认过的情况；从收藏推测、待确认的情况 | 确认 180 天、待确认 7 天 |
| `decisions` | 想过的问题、选过的条件、上次建议 | 关闭「记住」即删除 |
| `results` | 实时检索结果（决策陪伴按编号取原话） | 14 天 |

知乎 OAuth token 不入库，只在进程内存里放最多 1 小时；服务重启后用户仍登录，但读收藏要重新授权。
「我的情况」只有用户主动打开「记住我的情况」才写库；关闭即删除情况与决策记录，「删除我在知镜的全部数据」删除用户记录（级联删除会话）。

备份（按需）：`sudo -u zhijing pg_dump -h /var/run/postgresql zhijing > /root/zhijing-$(date +%F).sql`。

没配置 `DATABASE_URL` 时（本地开发、测试）自动改用内存存储，重启即清空。PostgreSQL 实现的测试：`ZHIJING_TEST_DATABASE_URL=postgresql://<用户>@%2Ftmp/zhijing_test npm test`（会清空该库里知镜的表，务必用专用测试库）。

## 修改配置

编辑 `/etc/zhijing/zhijing.env` 后 `systemctl restart zhijing`。不要把其中的值贴到聊天、日志、截图或视频里。
