#!/usr/bin/env bash
# Ubuntu/Debian installer and in-app updater. Run as your normal user; only APT needs sudo.
# Everything lives in functions and main runs last: Bash reads scripts piece by piece.
set -euo pipefail

REPO_URL=https://github.com/pelmenipower/Shellherd
API_URL=https://api.github.com/repos/pelmenipower/Shellherd/releases/latest
SIGNER_IDENTITY=$REPO_URL/.github/workflows/release.yml@refs/heads/main
SELF=${BASH_SOURCE[0]:-}
VERSION_RE='^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$'
PID_RE='^[1-9][0-9]{0,9}$'

version=''
local_package=''
appimage=''
from_app=0
wait_pid=''
handoff=''
work_dir=''
tmp_image=''
orig_args=("$@")

fail() { printf 'Shellherd: %s\n' "$*" >&2; exit 1; }
say() { if [[ -z $handoff ]]; then printf '%s\n' "$*"; fi; }

usage() {
  cat <<'EOF'
Shellherd für Ubuntu/Debian amd64 installieren oder aktualisieren

  bash install.sh                            Neueste veröffentlichte Version (DEB)
  bash install.sh --version 0.30.0            Bestimmte veröffentlichte Version (DEB)
  bash install.sh --package /pfad/app.deb     Lokal gebautes Paket
  bash install.sh --appimage /pfad/Shellherd.AppImage [--version 0.30.0]
                                              Diese AppImage-Datei ersetzen

Downloads werden vor der Installation gegen die SHA256SUMS des Releases geprüft.
Ist cosign installiert, wird auch deren Sigstore-Signatur geprüft.
Nur der APT-Installationsschritt benötigt Administratorrechte.
EOF
}

remove_private_copy() {
  # The app starts this script from a private copy in <tmp>/shellherd-update-*; remove exactly that folder.
  local dir tmp
  [[ $SELF == /* ]] || return 0
  dir=${SELF%/*}
  tmp=${TMPDIR:-/tmp}
  tmp=${tmp%/}
  [[ ${dir##*/} == shellherd-update-* && ${dir%/*} == "$tmp" && ! -L $dir ]] || return 0
  rm -rf -- "$dir"
}

on_exit() {
  local status=$?
  trap - EXIT
  [[ -z $work_dir ]] || rm -rf -- "$work_dir"
  [[ -z $tmp_image ]] || rm -f -- "$tmp_image"
  remove_private_copy
  # Only the outermost update run holds the terminal open.
  if ((from_app)) && [[ -z $handoff && -t 0 ]]; then
    if ((status != 0)); then
      printf '\nShellherd: Das Update ist fehlgeschlagen. Die bisherige Version bleibt installiert.\n'
      printf 'Falls Shellherd nicht mehr läuft, starte es neu.\n'
    fi
    printf '\nEnter zum Schließen '
    read -r _ || true
  fi
  exit "$status"
}

parse_args() {
  while (($#)); do
    case "$1" in
      --version|--package|--appimage|--wait-pid)
        (($# >= 2)) || fail "Wert für $1 fehlt."
        case "$1" in
          --version) version=${2#v} ;;
          --package) local_package=$2 ;;
          --appimage) appimage=$2 ;;
          --wait-pid) wait_pid=$2 ;;
        esac
        shift 2 ;;
      --from-app) from_app=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "Unbekanntes Argument: $1" ;;
    esac
  done
  [[ -z $version || -z $local_package ]] || fail '--version und --package können nicht kombiniert werden.'
  [[ -z $appimage || -z $local_package ]] || fail '--appimage und --package können nicht kombiniert werden.'
  if [[ -n $version ]]; then [[ $version =~ $VERSION_RE ]] || fail 'Ungültige Release-Version.'; fi
  if ((from_app)); then
    [[ -z $local_package ]] || fail '--from-app und --package können nicht kombiniert werden.'
    [[ -n $version ]] || fail '--from-app verlangt --version.'
    [[ -n $wait_pid ]] || fail '--from-app verlangt --wait-pid.'
  elif [[ -n $wait_pid ]]; then
    fail '--wait-pid ist nur mit --from-app erlaubt.'
  fi
  if [[ -n $wait_pid ]]; then [[ $wait_pid =~ $PID_RE ]] || fail 'Ungültige Prozess-ID.'; fi
  if [[ -n $appimage ]]; then
    [[ $appimage == /* ]] || fail 'Der Pfad der AppImage-Datei muss absolut sein.'
    [[ -f $appimage && ! -L $appimage ]] || fail "AppImage-Datei nicht gefunden: $appimage"
    [[ -w ${appimage%/*}/ ]] || fail "Der Ordner der AppImage-Datei ist nicht beschreibbar: ${appimage%/*}"
  fi
}

check_environment() {
  [[ $(uname -s) == Linux ]] || fail 'Dieser Installer unterstützt Linux.'
  [[ $(uname -m) == x86_64 ]] || fail 'Derzeit wird ausschließlich Linux x86_64 unterstützt.'
  if ((from_app)) || [[ -n $appimage ]]; then
    ((EUID != 0)) || fail 'Bitte als normaler Benutzer ausführen, nicht mit sudo.'
  fi
  local tools=(sha256sum mktemp flock) command
  if [[ -n $appimage ]]; then
    tools+=(setsid)
  else
    tools+=(apt-get dpkg-deb dpkg)
  fi
  [[ -n $local_package ]] || tools+=(curl)
  for command in "${tools[@]}"; do
    command -v "$command" >/dev/null || fail "Benötigtes Programm fehlt: $command"
  done
  if [[ -z $appimage ]]; then
    [[ $(dpkg --print-architecture </dev/null) == amd64 ]] || fail 'Benötigt ein amd64-System.'
    if ((EUID != 0)); then command -v sudo >/dev/null || fail 'sudo fehlt; bitte einen Administrator um Installation bitten.'; fi
  fi
}

acquire_lock() {
  exec 9>>"${XDG_RUNTIME_DIR:-/tmp}/shellherd-install-$(id -u).lock"
  flock -n 9 || fail 'Ein anderer Shellherd-Installer läuft bereits.'
}

download() { # download <url> <file>
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --max-time 600 \
    "$1" -o "$2" </dev/null
}

fetch() { # fetch <asset name> from the release of $version into the work dir
  download "$REPO_URL/releases/download/v$version/$1" "$work_dir/$1"
}

latest_version() {
  local tag
  command -v python3 >/dev/null || fail 'python3 fehlt. Alternativ --version angeben.'
  tag=$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --max-time 600 "$API_URL" </dev/null |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])') ||
    fail 'Die neueste Version konnte nicht ermittelt werden.'
  printf '%s' "${tag#v}"
}

expected_sum() { # expected_sum <asset>; prints the one matching checksum
  local sum
  sum=$(awk -v asset="$1" '$2 == asset { print $1; count++ } END { if (count != 1) exit 1 }' "$work_dir/SHA256SUMS") ||
    return 1
  [[ $sum =~ ^[a-fA-F0-9]{64}$ ]] || return 1
  printf '%s' "$sum"
}

verify_asset() { # verify_asset <asset>
  local expected
  expected=$(expected_sum "$1") || fail "Keine eindeutige Prüfsumme für $1 im Release."
  printf '%s  %s\n' "$expected" "$work_dir/$1" | sha256sum --check --status ||
    fail "Prüfsumme von $1 stimmt nicht überein."
}

verify_signature() {
  if command -v cosign >/dev/null 2>&1; then
    if fetch SHA256SUMS.sigstore.json; then
      cosign verify-blob --bundle "$work_dir/SHA256SUMS.sigstore.json" \
        --certificate-identity "$SIGNER_IDENTITY" \
        --certificate-oidc-issuer https://token.actions.githubusercontent.com \
        "$work_dir/SHA256SUMS" </dev/null >/dev/null 2>&1 ||
        fail 'Die Signatur von SHA256SUMS ist ungültig. Nichts wurde installiert.'
      say 'Signatur geprüft (Sigstore)'
    elif ((from_app)); then
      # The in-app update only targets signed releases; a missing bundle must not fall back to checksums.
      fail 'Dem Release fehlt die Sigstore-Signatur. Nichts wurde installiert.'
    else
      say 'Dieses Release hat keine Sigstore-Signatur; nur Prüfsummen.'
    fi
  else
    say 'cosign nicht gefunden: nur Prüfsummen (siehe README, Abschnitt „Verify a download“)'
  fi
}

handoff_if_stale() {
  local own expected status=0
  if [[ -n $handoff || -z $SELF || ! -f $SELF ]]; then return 0; fi
  # Older releases do not list install.sh; keep running this copy then.
  expected=$(expected_sum install.sh) || return 0
  own=$(sha256sum <"$SELF") || return 0
  own=${own%% *}
  if [[ $own == "$expected" ]]; then return 0; fi
  fetch install.sh || fail 'install.sh des Releases konnte nicht geladen werden.'
  verify_asset install.sh
  say "Übergabe an den Installer von Shellherd $version …"
  exec 9>&- # the child takes the lock itself
  SHELLHERD_INSTALL_HANDOFF=1 bash "$work_dir/install.sh" "${orig_args[@]}" </dev/null || status=$?
  exit "$status"
}

wait_for_app() {
  local waited=0
  say 'Warte, bis Shellherd beendet ist …'
  while kill -0 "$wait_pid" 2>/dev/null; do
    ((waited < 240)) || fail "Shellherd läuft noch (PID $wait_pid). Beende es und starte das Update erneut."
    sleep 0.25
    waited=$((waited + 1))
  done
}

install_deb() {
  local package=$work_dir/shellherd.deb
  if [[ -n $local_package ]]; then
    [[ -f $local_package ]] || fail "Paket nicht gefunden: $local_package"
    cp -- "$local_package" "$package"
  else
    local asset=Shellherd-$version-amd64.deb
    printf 'Lade Shellherd %s herunter …\n' "$version"
    download "$REPO_URL/releases/download/v$version/$asset" "$work_dir/$asset" ||
      fail 'Für diesen Release ist noch kein Linux-DEB verfügbar.'
    verify_asset "$asset"
    mv -- "$work_dir/$asset" "$package"
  fi
  [[ $(dpkg-deb -f "$package" Package </dev/null) == shellherd ]] || fail 'Das ist kein Shellherd-Paket.'
  [[ $(dpkg-deb -f "$package" Architecture </dev/null) == amd64 ]] || fail 'Das Paket ist nicht für amd64.'
  chmod 644 "$package"
  printf 'Installiere Shellherd %s über APT …\n' "$(dpkg-deb -f "$package" Version </dev/null)"
  if ((EUID == 0)); then
    apt-get install --reinstall -y "$package" </dev/null
  else
    sudo apt-get install --reinstall -y "$package"
  fi
}

install_appimage() {
  local asset=Shellherd-$version-x86_64.AppImage dir=${appimage%/*}
  printf 'Lade Shellherd %s herunter …\n' "$version"
  fetch "$asset" || fail 'Für diesen Release ist noch keine AppImage-Datei verfügbar.'
  verify_asset "$asset"
  tmp_image=$(mktemp "$dir/.Shellherd.AppImage.XXXXXX" </dev/null) ||
    fail "Der Ordner der AppImage-Datei ist nicht beschreibbar: $dir"
  cp -- "$work_dir/$asset" "$tmp_image"
  chmod 755 "$tmp_image"
  mv -f -- "$tmp_image" "$appimage" # atomic; the running instance keeps the old inode
  tmp_image=''
  printf 'Ersetzt: %s (jetzt Shellherd %s)\n' "$appimage" "$version"
}

relaunch_app() {
  local relaunch=${appimage:-/opt/Shellherd/shellherd}
  [[ -x $relaunch ]] || fail "Shellherd wurde installiert, lässt sich aber nicht starten: $relaunch"
  (cd "$HOME" && exec env -u SHELLHERD_INSTALL_HANDOFF setsid -f "$relaunch" </dev/null >/dev/null 2>&1 9>&-) ||
    fail "Shellherd konnte nicht gestartet werden: $relaunch"
  printf 'Shellherd %s ist installiert und wird gestartet.\n' "$version"
}

main() {
  # First action: even early failures (missing tool, busy lock, bad arguments) must reach on_exit.
  trap on_exit EXIT
  if [[ ${SHELLHERD_INSTALL_HANDOFF:-} == 1 ]]; then handoff=1; fi
  unset SHELLHERD_INSTALL_HANDOFF
  parse_args "$@"
  check_environment
  acquire_lock
  work_dir=$(mktemp -d -t shellherd-install.XXXXXXXX </dev/null)
  chmod 755 "$work_dir" # APT's _apt user must be able to read this public package.

  if [[ -z $local_package ]]; then
    [[ -n $version ]] || version=$(latest_version)
    [[ $version =~ $VERSION_RE ]] || fail 'Ungültige Release-Version.'
    fetch SHA256SUMS || fail 'Release-Prüfsummen fehlen; Installation abgebrochen.'
    verify_signature
    handoff_if_stale
  fi
  if ((from_app)); then wait_for_app; fi
  if [[ -n $appimage ]]; then install_appimage; else install_deb; fi
  if ((from_app)); then
    relaunch_app
  elif [[ -z $appimage ]]; then
    printf '\nInstalliert. Starte Shellherd über das Anwendungsmenü oder mit: shellherd\n'
  fi
}

main "$@"
exit
