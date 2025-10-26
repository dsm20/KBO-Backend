

#include <iostream>
#include <windows.h>
#include <map>
#include <deque>

// Compilation: x86_64-w64-mingw32-g++ KeyboardListener.cpp -o KeyboardHookTest.exe -static -luser32 -lgdi32 (need to compile with "static" because of lack of DLL's)

// Global handle for the hook
HHOOK hHook = NULL;

std::deque<DWORD> g_keyHistory;



// Function to get name of modifier key before I figure out a better way
// DWORD:keyname -> 162:ctrl, 255:fn, 164:alt, 91:win, 160:shift, 20:caps, 9:tab, 27:esc 
std::string getSpecialKeyName(DWORD vkCode) {
    // Mapping from VK Code (DWORD) to Key Name (std::string)
    static const std::map<DWORD, std::string> specialKeys = {
        {162, "ctrl"},
        {255, "fn"},
        {164, "alt"},
        {91, "win"},
        {160, "shift"},
        {20, "caps"},
        {9, "tab"},
        {27, "esc"}
    };

    // Use map::find to check for the key's existence and retrieve the value
    std::map<DWORD, std::string>::const_iterator it = specialKeys.find(vkCode);

    if (it != specialKeys.end()) {
        return it->second; // 'it->second' is the string (key name)
    } else {
        return "None";
    }
}


std::deque<DWORD> updateKeyHistory(DWORD vkCode){

//  Add the new key name to the back (most recent).
    g_keyHistory.push_back(vkCode);

    // Enforce the size limit (5). If the queue is too large, remove the oldest.
    if (g_keyHistory.size() > 5) {
        g_keyHistory.pop_front(); // Remove the element from the front (oldest).
    }

    return g_keyHistory;
}


// Function for state tracking (this will be the "first stop" function and in here separate functions will be called for mod keys and/or sliding window)
void intakeKey(bool stroke, DWORD vkCode) {
    // call additional function here to maintain sliding window (queue or stack?) and modifier key state management (separate function)
    // put the proof of concept print statement here (because we dont need to see key up/key down as is the case with the current print statements)

    // Printing stuff 
    if (stroke) 
    {
        // Update key history with function 
        updateKeyHistory(vkCode);
        std::cout << "Key Down:   " << vkCode << "   Modifiers: " << getSpecialKeyName(vkCode) << std::endl;
        // Print key history after downstroke (most up to date queue of keystrokes including "holds")
        std::cout << "History: [";
        bool first = true;
        for (DWORD code : g_keyHistory) {
            if (!first) {
                std::cout << ", ";
            }
            std::cout << code;
            first = false;
        }
        std::cout << "]" << std::endl;

    }
    else
    {
        std::cout << "Key Up:   " << vkCode << std::endl;

    }

}

// Function to send a single key to frontend or next file (data type undecided, ex: DWORD, string, int, etc)
DWORD sendKey() {

}

// Function to send the key queue (actual data type to send is undecided as of yet)
// Note that this and the above functions will be essentially "frames" of what is going to be displayed on the frontend
// as in all neccesary information needs to be packaged and sent within these functions, including extra misc info such as
// multi-modifier shortcuts (CTRL + ALT + Delete). Naturally these functions will likely have multiple params

// ASK MIRANDA: will the display have a separate section for current mod keys being held 
std::deque<DWORD> sendKeys() {

}

// These functions are called by the LowLevelKeyboardProc
void oneKeydown(DWORD vkCode) {
	// Here do some decoding of the vkCode in order to display the key pressed properly
	// Additionally, figure out way to track states (mainly of modifier keys but also keeping a "sliding window" of characters pressed)
	// 
    //std::cout << "Key Down: " << vkCode << std::endl;
    intakeKey(1, vkCode);
}

void oneKeyup(DWORD vkCode) {
    //std::cout << "Key Up:   " << vkCode << std::endl;
    intakeKey(0, vkCode);
}



// planned flow: keyup/down function -> intakeKey() -> process & track -> call respective oneKeyUp/oneKeyDown function from within intakeKey() -> print "state" of the keystroke
// ex: printed view will show which mod keys are being held, as well as whatever other keys are beind held, as well as the sliding window.

// ----------------------------------------

// Callback function
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
            // oneKeydown(vkCode);
            // break;
        case WM_SYSKEYDOWN:
            oneKeydown(vkCode);
            break;

        case WM_KEYUP:
            // oneKeyup(vkCode);
            // break;
        case WM_SYSKEYUP:
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

    // Error handling
    if (hHook == NULL) {
        std::cerr << "Failed to install hook. Error: " << GetLastError() << std::endl;
    } else {
        std::cout << "Successfully installed WH_KEYBOARD_LL hook. Listening for keys. Ctrl+C to exit." << std::endl;
    }
}

// // Function to unset the hook UNIMPLEMENTED
// void UnsetGlobalHook() {
//     if (hHook != NULL) {
//         UnhookWindowsHookEx(hHook);
//         hHook = NULL;
//         std::cout << "\nKeyboard hook uninstalled." << std::endl;
//     }
// }

// MAIN!!!!
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
        
        // Alternative way to quit is to program an exit key (such as ESC) inside the callback function
    }
    
    //UnsetGlobalHook();

    return 0;
}