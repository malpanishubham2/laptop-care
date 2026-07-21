type Platform = "darwin" | "win32";

interface CommandEntry {
  darwin: string | null;
  win32: string | null;
}

export const COMMANDS: Record<string, CommandEntry> = {
  system_info: {
    darwin: `system_profiler SPHardwareDataType SPSoftwareDataType 2>/dev/null | grep -E "Model|Chip|Memory|System Version|Computer Name"`,
    win32: `powershell -NoProfile -Command "Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,@{N='RAM_GB';E={[math]::Round($_.TotalPhysicalMemory/1GB,1)}} | ConvertTo-Json; Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber | ConvertTo-Json; Get-CimInstance Win32_Processor | Select-Object Name | ConvertTo-Json"`,
  },

  disk_space: {
    darwin: `df -h / /System/Volumes/Data 2>/dev/null | grep -v "map "`,
    win32: `powershell -NoProfile -Command "Get-Volume | Where-Object {$_.DriveLetter} | Select-Object DriveLetter,FileSystemLabel,@{N='FreeGB';E={[math]::Round($_.SizeRemaining/1GB,2)}},@{N='TotalGB';E={[math]::Round($_.Size/1GB,2)}} | ConvertTo-Json"`,
  },

  large_folders: {
    darwin: `du -sh ~/Desktop ~/Documents ~/Downloads ~/Library ~/Pictures ~/Music ~/Movies 2>/dev/null | sort -rh | head -10`,
    win32: `powershell -NoProfile -Command "$folders = @('Desktop','Documents','Downloads','Pictures','Music','Videos'); $results = foreach($f in $folders){$p = Join-Path $env:USERPROFILE $f; if(Test-Path $p){$size = (Get-ChildItem $p -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum; [PSCustomObject]@{Folder=$f;SizeGB=[math]::Round($size/1GB,2)}}}; $results | Sort-Object SizeGB -Descending | ConvertTo-Json"`,
  },

  temp_files_scan: {
    darwin: `{ echo "=== User Caches ==="; du -sh ~/Library/Caches 2>/dev/null || echo "(unreadable)"; echo "=== System Temp ==="; du -sh /tmp 2>/dev/null || echo "(unreadable)"; echo "=== Logs ==="; du -sh ~/Library/Logs 2>/dev/null || echo "(unreadable)"; echo "=== Trash ==="; du -sh ~/.Trash 2>/dev/null || echo "0B"; echo "=== Homebrew Cache ==="; du -sh ~/Library/Caches/Homebrew 2>/dev/null || echo "(none)"; }`,
    win32: `powershell -NoProfile -Command "$temp = (Get-ChildItem $env:TEMP -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum); $winTemp = (Get-ChildItem 'C:\\Windows\\Temp' -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum); [PSCustomObject]@{UserTempGB=[math]::Round($temp.Sum/1GB,2);UserTempFiles=$temp.Count;WinTempGB=[math]::Round($winTemp.Sum/1GB,2);WinTempFiles=$winTemp.Count} | ConvertTo-Json"`,
  },

  temp_files_clean: {
    darwin: `rm -rf ~/Library/Caches/* ~/Library/Logs/*.log /tmp/com.apple.* 2>/dev/null; echo '{"status":"cleaned","targets":["~/Library/Caches/*","~/Library/Logs/*.log","/tmp/com.apple.*"]}'`,
    win32: `powershell -NoProfile -Command "Remove-Item $env:TEMP\\* -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item 'C:\\Windows\\Temp\\*' -Recurse -Force -ErrorAction SilentlyContinue; Write-Output '{\"status\":\"cleaned\",\"targets\":[\"$env:TEMP\",\"C:\\Windows\\Temp\"]}';"`,
  },

  os_update_check: {
    darwin: `softwareupdate --list 2>&1`,
    win32: `powershell -NoProfile -Command "try { $session = New-Object -ComObject Microsoft.Update.Session; $searcher = $session.CreateUpdateSearcher(); $results = $searcher.Search('IsInstalled=0'); $results.Updates | Select-Object Title,IsDownloaded,IsMandatory | ConvertTo-Json } catch { Write-Output '{\"error\":\"Windows Update COM not available\",\"suggestion\":\"Run Get-WindowsUpdate if PSWindowsUpdate module is installed\"}' }"`,
  },

  battery_health: {
    darwin: `system_profiler SPPowerDataType 2>/dev/null | grep -E "Cycle Count|Condition|Maximum Capacity|Charge Remaining|Full Charge Capacity|Battery Installed"`,
    win32: `powershell -NoProfile -Command "powercfg /batteryreport /output $env:TEMP\\batt.html 2>$null; if(Test-Path $env:TEMP\\batt.html){$html=[System.IO.File]::ReadAllText(\"$env:TEMP\\batt.html\"); $dc=if($html -match 'DESIGN CAPACITY.*?(\\d[\\d,]+)\\s*mWh'){$matches[1]-replace',',''}else{'N/A'}; $fc=if($html -match 'FULL CHARGE CAPACITY.*?(\\d[\\d,]+)\\s*mWh'){$matches[1]-replace',',''}else{'N/A'}; $cc=if($html -match 'CYCLE COUNT.*?(\\d+)'){$matches[1]}else{'N/A'}; [PSCustomObject]@{DesignCapacity_mWh=$dc;FullChargeCapacity_mWh=$fc;CycleCount=$cc;WearPct=if($dc-ne'N/A'-and$fc-ne'N/A'){[math]::Round((1-[int]$fc/[int]$dc)*100,1)}else{'N/A'}} | ConvertTo-Json} else { Write-Output '{\"error\":\"No battery detected or report failed\"}' }"`,
  },

  ssd_health: {
    darwin: `diskutil info disk0 | grep -E "SMART|Solid State|Media Name|Device Model"`,
    win32: `powershell -NoProfile -Command "Get-PhysicalDisk | Select-Object FriendlyName,MediaType,HealthStatus,OperationalStatus,@{N='SizeGB';E={[math]::Round($_.Size/1GB,0)}} | ConvertTo-Json; try{Get-PhysicalDisk | Get-StorageReliabilityCounter | Select-Object Wear,ReadErrorsTotal,WriteErrorsTotal,Temperature,PowerOnHours | ConvertTo-Json}catch{Write-Output '{\"note\":\"StorageReliabilityCounter not available\"}'}"`,
  },

  sleep_wake_log: {
    darwin: `pmset -g log 2>/dev/null | grep -E "Sleep|Wake|DarkWake" | tail -20`,
    win32: `powershell -NoProfile -Command "Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-Kernel-Power';Id=42,107,507} -MaxEvents 20 -ErrorAction SilentlyContinue | Select-Object TimeCreated,Id,Message | ConvertTo-Json"`,
  },

  security_status: {
    darwin: `/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null; echo "---"; spctl --status 2>/dev/null; echo "---"; /usr/bin/csrutil status 2>/dev/null`,
    win32: `powershell -NoProfile -Command "Get-MpComputerStatus | Select-Object AntivirusEnabled,RealTimeProtectionEnabled,AntivirusSignatureLastUpdated,AntispywareEnabled,IsTamperProtected | ConvertTo-Json"`,
  },

  encryption_status: {
    darwin: `fdesetup status`,
    win32: `powershell -NoProfile -Command "Get-BitLockerVolume | Select-Object MountPoint,ProtectionStatus,EncryptionPercentage,VolumeStatus,EncryptionMethod | ConvertTo-Json"`,
  },

  startup_items: {
    darwin: `osascript -e 'tell application "System Events" to get the name of every login item' 2>/dev/null; echo "=== Launch Agents ==="; ls ~/Library/LaunchAgents/ 2>/dev/null; echo "=== Global Launch Agents ==="; ls /Library/LaunchAgents/ 2>/dev/null`,
    win32: `powershell -NoProfile -Command "Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location | ConvertTo-Json"`,
  },

  boot_time: {
    darwin: `sysctl -n kern.boottime; echo "=== Uptime ==="; uptime`,
    win32: `powershell -NoProfile -Command "$os = Get-CimInstance Win32_OperatingSystem; [PSCustomObject]@{LastBoot=$os.LastBootUpTime;UptimeDays=[math]::Round(((Get-Date)-$os.LastBootUpTime).TotalDays,1)} | ConvertTo-Json"`,
  },

  firmware_check: {
    darwin: `system_profiler SPHardwareDataType | grep -E "Model|Chip|Firmware|Boot ROM|Serial"`,
    win32: `powershell -NoProfile -Command "Get-WmiObject Win32_BIOS | Select-Object SMBIOSBIOSVersion,ReleaseDate,Manufacturer,SerialNumber | ConvertTo-Json"`,
  },

  backup_status: {
    darwin: `tmutil status 2>/dev/null; echo "=== Latest Backup ==="; tmutil latestbackup 2>/dev/null || echo "No Time Machine backups found"`,
    win32: `powershell -NoProfile -Command "try{Get-WBSummary | ConvertTo-Json}catch{try{$restore=Get-ComputerRestorePoint | Select-Object -Last 1; $restore | Select-Object Description,CreationTime | ConvertTo-Json}catch{Write-Output '{\"status\":\"No backup solution detected\",\"suggestion\":\"Consider enabling File History or creating restore points\"}'}}"`,
  },

  energy_report: {
    darwin: `pmset -g 2>/dev/null; echo "=== Assertions ==="; pmset -g assertions 2>/dev/null | head -20`,
    win32: `powershell -NoProfile -Command "powercfg /energy /output $env:TEMP\\energy.html /duration 30; Start-Sleep -Seconds 35; if(Test-Path $env:TEMP\\energy.html){$content=[System.IO.File]::ReadAllText(\"$env:TEMP\\energy.html\"); $errors=([regex]::Matches($content,'Error')).Count; $warnings=([regex]::Matches($content,'Warning')).Count; [PSCustomObject]@{Errors=$errors;Warnings=$warnings;ReportPath=\"$env:TEMP\\energy.html\"} | ConvertTo-Json} else {Write-Output '{\"error\":\"Energy report generation failed\"}'}"`,
  },

  system_integrity_check: {
    darwin: `diskutil verifyVolume / 2>&1`,
    win32: `powershell -NoProfile -Command "sfc /scannow 2>&1 | Select-String -Pattern 'Windows Resource Protection|found|could not'"`,
  },

  empty_trash: {
    darwin: `osascript -e 'tell application "Finder" to empty trash' >/dev/null 2>&1; echo '{"status":"emptied"}'`,
    win32: `powershell -NoProfile -Command "Clear-RecycleBin -Force -ErrorAction SilentlyContinue; Write-Output '{\"status\":\"emptied\"}';"`,
  },

  flush_dns: {
    darwin: `sudo dscacheutil -flushcache 2>/dev/null; sudo killall -HUP mDNSResponder 2>/dev/null; echo '{"status":"flushed"}'`,
    win32: `powershell -NoProfile -Command "ipconfig /flushdns"`,
  },
};

export function getCommand(toolName: string): string | null {
  const platform = process.platform as Platform;
  if (platform !== "darwin" && platform !== "win32") return null;
  return COMMANDS[toolName]?.[platform] ?? null;
}
