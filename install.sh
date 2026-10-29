#!/usr/bin/env bash
# Ubuntu/Debian installer. Run as your normal user; only APT needs sudo.
set -euo pipefail

fail() { printf 'Shellherd: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Shellherd für Ubuntu/Debian amd64 installieren oder aktualisieren

  bash install.sh                         Neueste veröffentlichte Version
  bash install.sh --version 0.30.0         Bestimmte veröffentlichte Version
  bash install.sh --package /pfad/app.deb  Lokal gebautes Paket

Downloads werden vor der Installation gegen die SHA256SUMS des Releases geprüft.
Nur der APT-Installationsschritt benötigt Administratorrechte.
EOF
}
version=''
local_package=''
while (($#)); do
  case "$1" in
    --version|--package)
      (($# >= 2)) || fail "Wert für $1 fehlt."
      if [[ $1 == --version ]]; then version=${2#v}; else local_package=$2; fi
      shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unbekanntes Argument: $1" ;;
  esac
done
[[ -z $version || -z $local_package ]] || fail '--version und --package können nicht kombiniert werden.'
[[ $(uname -s) == Linux ]] || fail 'Dieser Installer unterstützt Linux.'
[[ $(uname -m) == x86_64 ]] || fail 'Derzeit wird ausschließlich Linux x86_64 unterstützt.'
for command in apt-get dpkg-deb dpkg sha256sum mktemp; do
  command -v "$command" >/dev/null || fail "Benötigtes Programm fehlt: $command"
done
[[ $(dpkg --print-architecture) == amd64 ]] || fail 'Benötigt ein amd64-System.'
if ((EUID != 0)); then command -v sudo >/dev/null || fail 'sudo fehlt; bitte einen Administrator um Installation bitten.'; fi

work_dir=$(mktemp -d -t shellherd-install.XXXXXXXX)
trap 'rm -rf -- "$work_dir"' EXIT
chmod 755 "$work_dir" # APT's _apt user must be able to read this public package.
package="$work_dir/shellherd.deb"
if [[ -n $local_package ]]; then
  [[ -f $local_package ]] || fail "Paket nicht gefunden: $local_package"
  cp -- "$local_package" "$package"
else
  command -v curl >/dev/null || fail 'curl fehlt. Installieren mit: sudo apt install curl'
  if [[ -z $version ]]; then
    command -v python3 >/dev/null || fail 'python3 fehlt. Alternativ --version angeben.'
    version=$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
      https://api.github.com/repos/pelmenipower/Shellherd/releases/latest |
      python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')
    version=${version#v}
  fi
  [[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Ungültige Release-Version.'
  asset="Shellherd-$version-amd64.deb"
  base="https://github.com/pelmenipower/Shellherd/releases/download/v$version"
  printf 'Lade Shellherd %s herunter …\n' "$version"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' "$base/$asset" -o "$package" ||
    fail 'Für diesen Release ist noch kein Linux-DEB verfügbar.'
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' "$base/SHA256SUMS" -o "$work_dir/SHA256SUMS" ||
    fail 'Release-Prüfsummen fehlen; Installation abgebrochen.'
  expected=$(awk -v asset="$asset" '$2 == asset { print $1; count++ } END { if (count != 1) exit 1 }' "$work_dir/SHA256SUMS") ||
    fail 'Keine eindeutige Paket-Prüfsumme im Release.'
  [[ $expected =~ ^[a-fA-F0-9]{64}$ ]] || fail 'Ungültige SHA-256-Prüfsumme.'
  printf '%s  %s\n' "$expected" "$package" | sha256sum --check --status || fail 'Paket-Prüfsumme stimmt nicht überein.'
fi
[[ $(dpkg-deb -f "$package" Package) == shellherd ]] || fail 'Das ist kein Shellherd-Paket.'
[[ $(dpkg-deb -f "$package" Architecture) == amd64 ]] || fail 'Das Paket ist nicht für amd64.'
chmod 644 "$package"
printf 'Installiere Shellherd %s über APT …\n' "$(dpkg-deb -f "$package" Version)"
if ((EUID == 0)); then
  apt-get install --reinstall -y "$package"
else
  sudo apt-get install --reinstall -y "$package"
fi
printf '\nInstalliert. Starte Shellherd über das Anwendungsmenü oder mit: shellherd\n'
