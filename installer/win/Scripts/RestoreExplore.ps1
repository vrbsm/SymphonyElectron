Remove-Item C:\Users\*\Desktop\Symphony*.lnk -Force
Remove-Item 'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Symphony\Symphony*.lnk' -Force
Stop-Process -ProcessName Explorer