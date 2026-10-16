# Zakazuje "npm run bekap" svaki dan u Windows Task Scheduler-u (talas 5, nalaz A1).
#   npm run zakazi-bekap                      -> svaki dan u 13:00
#   powershell -File alati/zakazi-bekap.ps1 -Vrijeme 09:30
#   powershell -File alati/zakazi-bekap.ps1 -Ukloni
# Radi pod vasim Windows nalogom, samo dok ste prijavljeni (lozinka Windowsa se ne trazi i ne cuva).
# Ako je racunar u to vrijeme bio ugasen, bekap se pokrene cim se upali (StartWhenAvailable).
# Ishod: bekap\POSLJEDNJI-BEKAP.txt, a ispis svakog pokretanja u bekap\zakazano.log.
# (Samo ASCII slova u ovom fajlu: PowerShell 5.1 fajl bez BOM-a cita kao ANSI.)
param(
  [string]$Vrijeme = "13:00",
  [switch]$Ukloni
)

$ErrorActionPreference = "Stop"
$ime = "PILOT Distributeri - dnevni bekap"
$projekat = Split-Path -Parent $PSScriptRoot

if ($Ukloni) {
  if (Get-ScheduledTask -TaskName $ime -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $ime -Confirm:$false
    Write-Host "Zadatak '$ime' je uklonjen."
  } else {
    Write-Host "Zadatak '$ime' ne postoji."
  }
  exit 0
}

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) { throw "npm nije pronadjen - instalirajte Node.js ili otvorite novi terminal." }
New-Item -ItemType Directory -Force -Path (Join-Path $projekat "bekap") | Out-Null

$komanda = "/c cd /d `"$projekat`" && `"$npm`" run bekap >> `"$projekat\bekap\zakazano.log`" 2>&1"
$akcija = New-ScheduledTaskAction -Execute "cmd.exe" -Argument $komanda -WorkingDirectory $projekat
$okidac = New-ScheduledTaskTrigger -Daily -At $Vrijeme
$podesavanja = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $ime -Action $akcija -Trigger $okidac -Settings $podesavanja -Description "npm run bekap - pg_dump svih klijenata iz alati/klijenti.txt" -Force | Out-Null

Write-Host "Zakazano: '$ime' svaki dan u $Vrijeme (i cim se racunar upali, ako je tada bio ugasen)."
Write-Host "Provjera: Task Scheduler -> Task Scheduler Library -> '$ime', ili bekap\POSLJEDNJI-BEKAP.txt poslije prvog pokretanja."
