; egUDF installer additions (electron-builder nsis.include).
;
; .docx: register egUDF as an *available* handler — it shows up in "Open with"
; and in Windows Settings → Default apps → egUDF — without taking the default
; away from Word. (electron-builder's fileAssociations would overwrite the
; .docx default, so .docx is registered here instead.) The user makes egUDF the
; default from Windows or from egUDF (Seçenekler → Word belgeleri).

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\egUDF.docx" "" "Word belgesi"
  WriteRegStr SHCTX "Software\Classes\egUDF.docx\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr SHCTX "Software\Classes\egUDF.docx\shell\open" "" "egUDF ile aç"
  WriteRegStr SHCTX "Software\Classes\egUDF.docx\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegNone SHCTX "Software\Classes\.docx\OpenWithProgids" "egUDF.docx"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".docx" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".udf" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "egUDF"

  ; Default Apps capabilities
  WriteRegStr SHCTX "Software\egUDF\Capabilities" "ApplicationName" "egUDF"
  WriteRegStr SHCTX "Software\egUDF\Capabilities" "ApplicationDescription" "UYAP .udf ve Word .docx belge düzenleyicisi"
  WriteRegStr SHCTX "Software\egUDF\Capabilities\FileAssociations" ".docx" "egUDF.docx"
  WriteRegStr SHCTX "Software\egUDF\Capabilities\FileAssociations" ".udf" "UYAP Document"
  WriteRegStr SHCTX "Software\RegisteredApplications" "egUDF" "Software\egUDF\Capabilities"

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\egUDF.docx"
  DeleteRegValue SHCTX "Software\Classes\.docx\OpenWithProgids" "egUDF.docx"
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey SHCTX "Software\egUDF"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "egUDF"
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
