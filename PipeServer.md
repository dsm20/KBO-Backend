Generated docs for Pipeserver.cpp

## CreateAndListen Docs:

Close(): defensive—if a previous instance exists, free it before creating a new one.

### CreateNamedPipeW:

Name: _name.c_str(); the canonical form is \\.\pipe\<your-name>.

PIPE_ACCESS_OUTBOUND: this server only writes to the pipe. The client is read-only. That matches your “backend pushes frames → UI reads” design. If you later want bi-directional (UI sends commands back), change to PIPE_ACCESS_DUPLEX.

FILE_FLAG_FIRST_PIPE_INSTANCE: optional guard; fail if another server already created the same pipe name. Good to avoid accidental double-hosting.

PIPE_TYPE_BYTE | PIPE_READMODE_BYTE: a byte stream pipe, not message-framed. You’re doing your own framing with [uint32 length][bytes], so a byte pipe is fine (and simplest).

PIPE_WAIT: blocking mode (synchronous I/O). Your worker thread does the writes; blocking is OK as long as you accept the possibility of a slow/blocked client stalling the writer. You handle that by closing on error.

Instance count 1: only one client can connect at a time. That’s intentional here; if you need multiple listeners (e.g., multiple overlays), increase it and call CreateNamedPipe per instance.

Outbound/inbound buffer sizes: 1<<16 (64 KiB) for both. For push-only, inbound is unused, but Windows still asks for it. 64 KiB is a reasonable default; your frames are tiny.

Timeout 0 and security nullptr: default timeout; default security descriptor (inherits caller’s). If you want to restrict who can connect (e.g., same user only), you’d pass an explicit SECURITY_ATTRIBUTES.

### ConnectNamedPipe: 

Waits for a client to connect. If the client connected between CreateNamedPipe and now, ConnectNamedPipe fails with ERROR_PIPE_CONNECTED; you treat that as success.

On success, _hPipe is a connected server endpoint you can WriteFile to.