; PDF Workbench installer hooks (Phase 10a), included by Tauri's NSIS template.
;
; Windows does not let an app make itself the default PDF program. What an installer
; may do is register the app as one that CAN open PDFs, so it shows up in
; Settings > Apps > Default apps. Tauri's template writes the ProgID
; (Software\Classes\PDFWorkbench.Document); these hooks add the rest:
;   Capabilities + RegisteredApplications  -> listed in Default apps
;   .pdf\OpenWithProgids                    -> listed in "Open with"
;   Applications\pdf-workbench.exe          -> friendly name, supported types
; The install is per user (installMode currentUser), so everything goes under HKCU.
; Nothing here changes the user's current default.

!define PW_PROGID "PDFWorkbench.Document"
!define PW_REGNAME "PDF Workbench"
!define PW_CAPS "Software\cjmdevs\PDF Workbench\Capabilities"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "${PW_CAPS}" "ApplicationName" "PDF Workbench"
  WriteRegStr HKCU "${PW_CAPS}" "ApplicationDescription" "View, organize, mark up and redact PDF files."
  WriteRegStr HKCU "${PW_CAPS}" "ApplicationIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
  WriteRegStr HKCU "${PW_CAPS}\FileAssociations" ".pdf" "${PW_PROGID}"
  WriteRegStr HKCU "Software\RegisteredApplications" "${PW_REGNAME}" "${PW_CAPS}"
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithProgids" "${PW_PROGID}" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "PDF Workbench"
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".pdf" ""
  WriteRegStr HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  !insertmacro UPDATEFILEASSOC
!macroend

; Updates run the uninstaller of the old version with /UPDATE first: keep the
; registration then, so the app never drops out of Default apps mid-update.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\RegisteredApplications" "${PW_REGNAME}"
    DeleteRegKey HKCU "${PW_CAPS}"
    DeleteRegKey /ifempty HKCU "Software\cjmdevs\PDF Workbench"
    DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "${PW_PROGID}"
    DeleteRegKey HKCU "Software\Classes\Applications\${MAINBINARYNAME}.exe"
    !insertmacro UPDATEFILEASSOC
  ${EndIf}
!macroend
