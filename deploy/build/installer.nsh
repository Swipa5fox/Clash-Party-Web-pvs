!ifdef BUILD_UNINSTALLER
  !include "LogicLib.nsh"
  !include "nsDialogs.nsh"
  !include "WinMessages.nsh"

Var /GLOBAL deleteUserData
Var /GLOBAL deleteUserDataCheckbox

!macro customUnWelcomePage
  !insertmacro MUI_UNPAGE_WELCOME
  UninstPage custom un.DeleteUserDataPage un.DeleteUserDataPageLeave
!macroend

!macro customUnInit
  StrCpy $deleteUserData "0"
!macroend

Function un.DeleteUserDataPage
  ${If} $LANGUAGE == 2052
    StrCpy $R3 "选择卸载时要保留或删除的数据。"
    StrCpy $R1 "同时删除用户数据（设置、订阅、日志等）"
    StrCpy $R2 "此操作无法撤销。默认情况下会保留用户数据。"
  ${ElseIf} $LANGUAGE == 1028
    StrCpy $R3 "選擇解除安裝時要保留或刪除的資料。"
    StrCpy $R1 "同時刪除使用者資料（設定、訂閱、記錄等）"
    StrCpy $R2 "此操作無法復原。預設情況下會保留使用者資料。"
  ${Else}
    StrCpy $R3 "Choose whether to keep or delete application data."
    StrCpy $R1 "Delete user data (settings, profiles, logs, etc.)"
    StrCpy $R2 "This cannot be undone. User data is kept by default."
  ${EndIf}

  GetDlgItem $R4 $HWNDPARENT 1037
  SendMessage $R4 ${WM_SETTEXT} 0 "STR:$(chooseUninstallationOptions)"
  GetDlgItem $R4 $HWNDPARENT 1038
  SendMessage $R4 ${WM_SETTEXT} 0 "STR:$R3"

  nsDialogs::Create 1018
  Pop $R0
  ${If} $R0 == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckbox} 0 18u 100% 14u "$R1"
  Pop $deleteUserDataCheckbox
  ${If} $deleteUserData == "1"
    ${NSD_Check} $deleteUserDataCheckbox
  ${EndIf}

  ${NSD_CreateLabel} 0 44u 100% 28u "$R2"
  Pop $R0

  nsDialogs::Show
FunctionEnd

Function un.DeleteUserDataPageLeave
  ${NSD_GetState} $deleteUserDataCheckbox $R0
  ${If} $R0 == ${BST_CHECKED}
    StrCpy $deleteUserData "1"
  ${Else}
    StrCpy $deleteUserData "0"
  ${EndIf}
FunctionEnd

!macro customUnInstall
  ${If} $deleteUserData == "1"
    # Electron user data is always stored for the current user.
    ${If} $installMode == "all"
      SetShellVarContext current
    ${EndIf}

    RMDir /r "$APPDATA\${APP_FILENAME}"
    !ifdef APP_PRODUCT_FILENAME
      RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
    !endif
    !ifdef APP_PACKAGE_NAME
      RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
    !endif

    ${If} $installMode == "all"
      SetShellVarContext all
    ${EndIf}
  ${EndIf}
!macroend
!endif
