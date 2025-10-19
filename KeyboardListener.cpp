

#include <iostream>
#include <windows.h>

// Global handle for the hook
HHOOK hHook = NULL;

// --- Your "Actual Module" Functions ---
// These functions are called by the LowLevelKeyboardProc
void oneKeydown(DWORD vkCode) {
    std::cout << "Key Down: " << vkCode << std::endl;
}

void oneKeyup(DWORD vkCode) {
    std::cout << "Key Up:   " << vkCode << std::endl;
}
// ----------------------------------------

// The Hook Procedure Callback
LRESULT CALLBACK LowLevelKeyboardProc(
    _In_ int    nCode,
    _In_ WPARAM wParam,
    _In_ LPARAM lParam
)
{
    // The hook processing starts here
    if (nCode == HC_ACTION)
    {
        KBDLLHOOKSTRUCT* pKeyBoard = (KBDLLHOOKSTRUCT*)lParam;
        DWORD vkCode = pKeyBoard->vkCode;

        switch (wParam)
        {
        case WM_KEYDOWN:
        case WM_SYSKEYDOWN:
            // Call your custom function for key down events
            oneKeydown(vkCode);
            break;

        case WM_KEYUP:
        case WM_SYSKEYUP:
            // Call your custom function for key up events
            oneKeyup(vkCode);
            break;
        }
    }

    // Pass the message to the next hook in the chain
    return CallNextHookEx(hHook, nCode, wParam, lParam);
}

// Function to set the hook
void SetGlobalHook() {
    // SetWindowsHookEx(
    //     idHook,                // WH_KEYBOARD_LL is the hook type
    //     lpfn,                  // LowLevelKeyboardProc function pointer
    //     hMod,                  // NULL or GetModuleHandle(NULL) for LL hooks
    //     dwThreadId             // 0 for a global hook
    // )
    hHook = SetWindowsHookEx(WH_KEYBOARD_LL, LowLevelKeyboardProc, 
                             GetModuleHandle(NULL), 0);

    if (hHook == NULL) {
        std::cerr << "Failed to install hook! Error: " << GetLastError() << std::endl;
    } else {
        std::cout << "Successfully installed WH_KEYBOARD_LL hook. Listening for keys. Press ESC to exit." << std::endl;
    }
}

// Function to unset the hook
void UnsetGlobalHook() {
    if (hHook != NULL) {
        UnhookWindowsHookEx(hHook);
        hHook = NULL;
        std::cout << "\nKeyboard hook uninstalled." << std::endl;
    }
}

// The main application entry point
int main() {
    SetGlobalHook();

    // The thread that installed the WH_KEYBOARD_LL hook MUST have a message loop
    // to receive the hook events.
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0) && hHook != NULL) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);

        // Check for an exit condition (e.g., if you process WM_QUIT or similar)
        // In this simple example, we rely on closing the console window
        // or a key being processed by LowLevelKeyboardProc to trigger an exit.
        
        // A simple way to end the program: if the ESC key is pressed,
        // it can be programmed inside the LowLevelKeyboardProc to call UnsetGlobalHook()
        // and then PostQuitMessage(0); to break the loop.
    }
    
    UnsetGlobalHook();

    return 0;
}