REG DELETE "HKCU\Software\Classes\symphony" /f
REG DELETE "HKLM\SOFTWARE\Classes\symphony" /f
REG DELETE "HKU\.DEFAULT\Software\Microsoft\Windows\CurrentVersion\Run" /v "Symphony" /f
REG DELETE "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Symphony" /f
REG DELETE "HKCR\symphony" /f