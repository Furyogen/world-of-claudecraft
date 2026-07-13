// Pure remote-command builders for the production CPU monitor.

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function cpuSampleCommand(options) {
  const container = shellQuote(options.container);
  return `set -eu
i=1
while [ "$i" -le ${options.sampleCount} ]; do
  LC_ALL=C sudo -n docker stats --no-stream --format '{{.CPUPerc}}' ${container}
  i=$((i + 1))
  if [ "$i" -le ${options.sampleCount} ]; then sleep ${options.sampleSpacingSeconds}; fi
done`;
}

export function safeInspectCommand(options) {
  const format =
    '{"id":{{json .Id}},"name":{{json .Name}},"imageId":{{json .Image}},"imageName":{{json .Config.Image}},"restartCount":{{.RestartCount}},"state":{{json .State}},"limits":{"memory":{{.HostConfig.Memory}},"nanoCpus":{{.HostConfig.NanoCpus}},"cpuQuota":{{.HostConfig.CpuQuota}},"cpuPeriod":{{.HostConfig.CpuPeriod}},"cpusetCpus":{{json .HostConfig.CpusetCpus}}}}';
  return `sudo -n docker inspect --format ${shellQuote(format)} ${shellQuote(options.container)}`;
}

export function hostContextCommand() {
  return `set -u
date -u +'%Y-%m-%dT%H:%M:%SZ'
hostname
uptime
free -h 2>&1 || true
vmstat 1 3 2>&1 || true`;
}

export function processContextCommand(options) {
  const container = shellQuote(options.container);
  return `set -eu
sudo -n docker top ${container} -eo pid,ppid,pcpu,pmem,stat,etime,comm,args
host_pid=$(sudo -n docker inspect --format '{{.State.Pid}}' ${container})
printf '\nHost PID: %s\n' "$host_pid"
ps -L -p "$host_pid" -o pid,tid,ppid,pcpu,pmem,stat,etime,comm,args 2>&1 || true
top -b -H -n 1 -p "$host_pid" 2>&1 | head -n 100 || true`;
}

export function oneStatsCommand(options) {
  return `LC_ALL=C sudo -n docker stats --no-stream --format '{{json .}}' ${shellQuote(options.container)}`;
}

export function bundleHashCommand(options) {
  return `sudo -n docker exec ${shellQuote(options.container)} sha256sum /app/dist-server/server.cjs`;
}

export function logsCommand(options) {
  return `sudo -n docker logs --timestamps --since ${shellQuote(options.logSince)} --tail 20000 ${shellQuote(options.container)} 2>&1`;
}

export function gameNodePidScript({ signal, expectedPid = null }) {
  if (expectedPid !== null && (!Number.isInteger(expectedPid) || expectedPid <= 0)) {
    throw new Error('expected game PID must be a positive integer');
  }
  const expectedPidGuard =
    expectedPid === null
      ? ''
      : `[ "$pid" = "${expectedPid}" ] || {
  echo "game Node PID changed before inspector signal" >&2
  exit 1
}`;
  return `set -eu
count=0
pid=''
for proc in /proc/[0-9]*; do
  [ "\${proc##*/}" = "$$" ] && continue
  [ -r "$proc/cmdline" ] || continue
  exe=$(readlink "$proc/exe" 2>/dev/null || true)
  [ "\${exe##*/}" = "node" ] || continue
  arg0=$(tr '\\000' '\\n' < "$proc/cmdline" | sed -n '1p')
  arg1=$(tr '\\000' '\\n' < "$proc/cmdline" | sed -n '2p')
  [ "\${arg0##*/}" = "node" ] || continue
  [ "$arg1" = "dist-server/server.cjs" ] || continue
  count=$((count + 1))
  pid=\${proc##*/}
done
if [ "$count" -ne 1 ]; then
  echo "expected one game Node process, found $count" >&2
  exit 1
fi
${expectedPidGuard}
${signal ? 'kill -USR1 "$pid"' : ':'}
printf '%s\n' "$pid"`;
}

export function dockerExecShellCommand(options) {
  return `sudo -n docker exec -i ${shellQuote(options.container)} sh`;
}

export function inspectorProbeCommand(options) {
  const source =
    "fetch('http://127.0.0.1:9229/json/list').then(r => console.log(r.ok ? 'open' : 'closed')).catch(() => console.log('closed'))";
  return `sudo -n docker exec ${shellQuote(options.container)} node -e ${shellQuote(source)}`;
}

export function duringStatsCommand(options) {
  const seconds = Math.ceil(options.profileMs / 1_000) + 5;
  const container = shellQuote(options.container);
  return `set -eu
ends_at=$(( $(date +%s) + ${seconds} ))
while [ "$(date +%s)" -lt "$ends_at" ]; do
  at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
  stats=$(LC_ALL=C sudo -n docker stats --no-stream --format '{{json .}}' ${container})
  printf '{"at":"%s","stats":%s}\n' "$at" "$stats"
done`;
}

export function profileCommand(options, gamePid) {
  return `sudo -n docker exec -i ${shellQuote(options.container)} env -i PATH=/usr/local/bin:/usr/bin:/bin WOC_PROFILE_MS=${options.profileMs} WOC_PROFILE_SAMPLE_INTERVAL_US=${options.profileSampleIntervalUs} WOC_EXPECTED_PID=${gamePid} WOC_CLOSE_INSPECTOR=1 node --input-type=module -`;
}

export function adminRequestCommand(method, endpoint, body = null) {
  const data = body === null ? '' : ` --data ${shellQuote(JSON.stringify(body))}`;
  return `set -eu
IFS= read -r token
printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "$token" |
  curl --silent --show-error --max-time 20 --request ${method} --header @-${data} ${shellQuote(`http://127.0.0.1:8787${endpoint}`)}`;
}
