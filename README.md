# KBO-Backend

Mockup of backend service for **Keystroke Overlay**, a PowerToys application that displays real-time keystrokes on screen using WinUI3 and .NET.

## Overview

This repository serves to demonstrate the backend functionality of Keystroke Overlay (PowerToys project). This implementation of a Windows Keyboard hook is designed to be high performance, utilizing multi-threading and lock-free data structures. Below is a detailed overview of architecture, tech utilized, and build steps. 

## Architecture

### Core Components

#### **KeyboardListener** (`KeyboardListener.cpp`)
- Installs a low-level keyboard hook (`WH_KEYBOARD_LL`) using Windows API
- Captures keystroke events (key down, key up, and character input)
- Snapshots modifier key states (Ctrl, Alt, Shift, Win) for each event
- High-precision timestamping using `QueryPerformanceCounter` (microsecond resolution)
- Translates virtual key codes to printable characters
- Pushes events into a lock-free SPSC queue

#### **EventQueue** (`EventQueue.h`)
- Lock-free Single-Producer Single-Consumer (SPSC) ring buffer
- Template-based implementation with configurable capacity (default: 1024 events)
- Uses atomic operations for thread-safe communication
- Zero-copy, wait-free data structure optimized for real-time performance

#### **KeystrokeEvent** (`KeystrokeEvent.h`)
Defines the event data structure:
```cpp
struct KeystrokeEvent {
    Type type;                   // Down, Up, or Char
    DWORD vk;                    // Virtual key code
    char32_t ch;                 // Unicode character (0 if non-printable)
    std::array<bool, 4> mods;    // [Ctrl, Alt, Shift, Win]
    uint64_t ts_micros;          // Microsecond timestamp
};
```

#### **Batcher** (`Batcher.cpp/h`)
- Worker thread that drains the event queue
- Batches multiple events together to reduce overhead
- Serializes events to JSON format
- Sends batched frames through the Named Pipe server

#### **PipeServer** (`Pipeserver.cpp/h`)
- Named Pipe server for inter-process communication
- Default pipe name: `\\.\pipe\KeystrokeOverlayPipe`
- One-way communication: backend (write-only) → frontend (read-only)
- Custom framing protocol: `[uint32 length][UTF-8 JSON data]`
- Handles client connection/disconnection gracefully
- 64 KiB buffer size for optimal throughput

## Data Flow

```
User Input → Keyboard Hook → Event Queue → Batcher → Named Pipe → WinUI3 Frontend
           (System Level)    (Lock-free)   (Thread)   (IPC)      (Display Overlay)
```

1. **Capture**: Low-level keyboard hook intercepts all keyboard events
2. **Queue**: Events are pushed to lock-free SPSC ring buffer
3. **Batch**: Worker thread drains queue and groups events
4. **Serialize**: Events are converted to JSON format
5. **Transmit**: JSON frames are sent via Named Pipe to frontend
6. **Display**: WinUI3 app receives and renders keystrokes on screen

## Building

### Prerequisites
- Windows 10/11
- MinGW-w64 (GCC for Windows) or MSVC
- Windows SDK

### Compilation Example
```bash
x86_64-w64-mingw32-g++ KeyboardListener.cpp Batcher.cpp Pipeserver.cpp \
  -o KeystrokeOverlay.exe \
  -static \
  -luser32 -lgdi32 \
  -std=c++17
```

**Note**: Use `-static` flag to statically link C++ runtime if distributing without DLL dependencies.

## Usage

1. **Start the backend**: Run the compiled executable
2. **Launch frontend**: Start the WinUI3 Keystroke Overlay application
3. The frontend automatically connects to the Named Pipe
4. Keystrokes are captured and displayed in real-time

## Configuration

The Named Pipe name can be customized in [Pipeserver.h](Pipeserver.h#L11):
```cpp
explicit PipeServer(const wchar_t *name = LR"(\\.\pipe\KeystrokeOverlayPipe)");
```

Event queue capacity can be adjusted in [KeyboardListener.cpp](KeyboardListener.cpp#L19):
```cpp
static SpscRing<KeystrokeEvent, 1024> g_q;  // Change 1024 to desired size
```

## Features

- **High Performance**: Lock-free queue and efficient batching minimize latency
- **Precise Timing**: Microsecond-resolution timestamps for accurate event ordering
- **Modifier Support**: Captures Ctrl, Alt, Shift, and Win key states
- **Unicode Support**: Handles wide character input (char32_t)
- **Robust IPC**: Graceful handling of client disconnections and reconnections
- **Low Overhead**: Optimized for real-time capture with minimal system impact

## Thread Model

- **Main Thread**: Installs keyboard hook and processes Windows message loop
- **Batcher Thread**: Drains event queue and sends data through Named Pipe
- **Hook Thread**: Windows-managed thread that executes the low-level hook callback

## Protocol

### Named Pipe Frame Format
```
┌─────────────┬──────────────────────────┐
│ uint32_t    │ UTF-8 JSON bytes         │
│ (4 bytes)   │ (variable length)        │
│ Length      │ Event Data               │
└─────────────┴──────────────────────────┘
```

### JSON Event Schema
```json
[
  {
    "type": "Down",
    "vk": 65,
    "ch": "A",
    "mods": [false, false, true, false],
    "ts": 1234567890123
  }
]
```

## Integration with PowerToys

This backend is designed to work with the Keystroke Overlay PowerToys module:
- Frontend: WinUI3 application (C#/.NET)
- Backend: This C++ service (system-level capture)
- Communication: Named Pipes (high-performance local IPC)

The frontend connects to the pipe, receives JSON-serialized keystroke events, and renders them as an on-screen overlay with visual effects.
