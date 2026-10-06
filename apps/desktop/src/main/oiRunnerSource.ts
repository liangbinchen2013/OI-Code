/**
 * OI 运行器源码：在独立控制台窗口运行目标程序。
 * 控制台支持 VT 时，把 `名字 | CPU:xxms | Mem:x.xMB` 钉在窗口底行并 20Hz 刷新；
 * 不支持 VT 时退化为窗口标题栏刷新。程序退出后打印统计并等待按键。
 * 由 OI-Code 用检测到的 g++ 编译一次并缓存（见 RunnerService）。
 */
export const OI_RUNNER_SOURCE = `// OI-Code 运行器（由 OI-Code 自动生成并编译，勿手改）
#include <windows.h>
#include <psapi.h>
#include <conio.h>
#include <cstdio>
#include <string>
#include <vector>

namespace {

unsigned long long fileTimeToMilliseconds(const FILETIME& time) {
    ULARGE_INTEGER value;
    value.LowPart = time.dwLowDateTime;
    value.HighPart = time.dwHighDateTime;
    return value.QuadPart / 10000ULL;
}

std::string toUtf8(const std::wstring& text) {
    if (text.empty()) {
        return std::string();
    }
    int size = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()),
                                   nullptr, 0, nullptr, nullptr);
    if (size <= 0) {
        return std::string();
    }
    std::string result(static_cast<size_t>(size), '\\0');
    WideCharToMultiByte(CP_UTF8, 0, text.c_str(), static_cast<int>(text.size()),
                        result.data(), size, nullptr, nullptr);
    return result;
}

void printLine(const std::wstring& text) {
    std::string utf8 = toUtf8(text + L"\\r\\n");
    fwrite(utf8.data(), 1, utf8.size(), stdout);
    fflush(stdout);
}

void writeText(const std::wstring& text) {
    std::string utf8 = toUtf8(text);
    fwrite(utf8.data(), 1, utf8.size(), stdout);
    fflush(stdout);
}

std::wstring quoteArgument(const std::wstring& argument) {
    std::wstring result = L"\\"";
    size_t backslashes = 0;
    for (wchar_t character : argument) {
        if (character == L'\\\\') {
            ++backslashes;
            result.push_back(character);
        } else if (character == L'"') {
            result.append(backslashes + 1, L'\\\\');
            result.push_back(L'"');
            backslashes = 0;
        } else {
            backslashes = 0;
            result.push_back(character);
        }
    }
    result.append(backslashes, L'\\\\');
    result.push_back(L'"');
    return result;
}

std::wstring buildStatusLine(const std::wstring& name, unsigned long long cpuMilliseconds,
                             SIZE_T workingSet) {
    wchar_t buffer[320];
    double memoryMb = static_cast<double>(workingSet) / (1024.0 * 1024.0);
    swprintf(buffer, 320, L"%ls | CPU:%llums | Mem:%.1fMB", name.c_str(), cpuMilliseconds, memoryMb);
    return buffer;
}

void ensureConsole() {
    if (GetConsoleWindow() == nullptr && AllocConsole()) {
        freopen("CONOUT$", "w", stdout);
        freopen("CONIN$", "r", stdin);
    }
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
}

bool enableVirtualTerminal() {
    HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD mode = 0;
    if (output == nullptr || output == INVALID_HANDLE_VALUE ||
        !GetConsoleMode(output, &mode)) {
        return false;
    }
    if ((mode & ENABLE_VIRTUAL_TERMINAL_PROCESSING) != 0) {
        return true;
    }
    return SetConsoleMode(output, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING) != 0;
}

int consoleHeight() {
    CONSOLE_SCREEN_BUFFER_INFO info;
    if (!GetConsoleScreenBufferInfo(GetStdHandle(STD_OUTPUT_HANDLE), &info)) {
        return 25;
    }
    int height = info.srWindow.Bottom - info.srWindow.Top + 1;
    return height > 2 ? height : 25;
}

int consoleWidth() {
    CONSOLE_SCREEN_BUFFER_INFO info;
    if (!GetConsoleScreenBufferInfo(GetStdHandle(STD_OUTPUT_HANDLE), &info)) {
        return 80;
    }
    int width = info.srWindow.Right - info.srWindow.Left + 1;
    return width > 8 ? width : 80;
}

void applyScrollRegion(int height) {
    std::string sequence = "\\x1b[1;" + std::to_string(height - 1) + "r";
    fwrite(sequence.data(), 1, sequence.size(), stdout);
    fflush(stdout);
}

void resetScrollRegion() {
    fputs("\\x1b[r", stdout);
    fflush(stdout);
}

// 设置滚动区域会把光标归位到左上角，这里把光标放回区域底部继续输出
void positionAtRegionBottom(int height) {
    COORD position{0, static_cast<SHORT>(height > 2 ? height - 2 : 0)};
    SetConsoleCursorPosition(GetStdHandle(STD_OUTPUT_HANDLE), position);
}

// 把状态行钉在窗口底行：保存/恢复光标，不干扰程序输出
void drawStatusLine(const std::wstring& text, int width, int height) {
    HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
    CONSOLE_SCREEN_BUFFER_INFO info;
    if (!GetConsoleScreenBufferInfo(output, &info)) {
        return;
    }
    SHORT row = static_cast<SHORT>(height - 1);
    if (row >= info.dwSize.Y) {
        row = info.dwSize.Y - 1;
    }
    COORD bottom{0, row};
    COORD saved = info.dwCursorPosition;
    DWORD written = 0;
    FillConsoleOutputCharacterW(output, L' ', static_cast<DWORD>(width), bottom, &written);
    FillConsoleOutputAttribute(output, info.wAttributes, static_cast<DWORD>(width), bottom,
                               &written);
    SetConsoleCursorPosition(output, bottom);
    writeText(text);
    SetConsoleCursorPosition(output, saved);
}

bool shouldPause() {
    wchar_t buffer[8];
    if (GetEnvironmentVariableW(L"OI_RUNNER_NO_PAUSE", buffer, 8) > 0) {
        return false;
    }
    DWORD mode = 0;
    return GetConsoleMode(GetStdHandle(STD_INPUT_HANDLE), &mode) != 0;
}

void pauseForAnyKey() {
    if (!shouldPause()) {
        return;
    }
    printLine(L"");
    printLine(L"按任意键退出 ...");
    while (_kbhit()) {
        _getch();
    }
    while (!_kbhit()) {
        Sleep(30);
    }
    _getch();
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc < 3) {
        ensureConsole();
        printLine(L"用法: oi-runner.exe <显示名> <可执行文件> [参数 ...]");
        pauseForAnyKey();
        return 2;
    }

    const std::wstring displayName = argv[1];
    const std::wstring executable = argv[2];

    ensureConsole();
    SetConsoleTitleW((displayName + L" - OI-Code").c_str());

    std::wstring commandLine = quoteArgument(executable);
    for (int index = 3; index < argc; ++index) {
        commandLine.push_back(L' ');
        commandLine += quoteArgument(argv[index]);
    }
    std::vector<wchar_t> mutableCommand(commandLine.begin(), commandLine.end());
    mutableCommand.push_back(L'\\0');

    // 程序输出在滚动区域上方滚动，状态行钉在底行（仅 VT 控制台）
    bool vt = enableVirtualTerminal();
    int height = consoleHeight();
    int width = consoleWidth();
    if (vt) {
        applyScrollRegion(height);
        positionAtRegionBottom(height);
    }

    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);
    PROCESS_INFORMATION processInfo{};
    if (!CreateProcessW(executable.c_str(), mutableCommand.data(), nullptr, nullptr, FALSE, 0,
                        nullptr, nullptr, &startupInfo, &processInfo)) {
        if (vt) {
            resetScrollRegion();
        }
        wchar_t buffer[128];
        swprintf(buffer, 128, L"启动失败（错误码 %lu）", GetLastError());
        printLine(buffer);
        pauseForAnyKey();
        return 1;
    }

    const ULONGLONG startTick = GetTickCount64();
    for (;;) {
        if (WaitForSingleObject(processInfo.hProcess, 50) == WAIT_OBJECT_0) {
            break;
        }
        FILETIME creationTime{}, exitTime{}, kernelTime{}, userTime{};
        unsigned long long cpuMilliseconds = 0;
        if (GetProcessTimes(processInfo.hProcess, &creationTime, &exitTime, &kernelTime, &userTime)) {
            cpuMilliseconds = fileTimeToMilliseconds(kernelTime) + fileTimeToMilliseconds(userTime);
        }
        SIZE_T workingSet = 0;
        PROCESS_MEMORY_COUNTERS counters{};
        if (GetProcessMemoryInfo(processInfo.hProcess, &counters, sizeof(counters))) {
            workingSet = counters.WorkingSetSize;
        }
        const std::wstring statusLine = buildStatusLine(displayName, cpuMilliseconds, workingSet);
        if (vt) {
            const int currentHeight = consoleHeight();
            if (currentHeight != height) {
                height = currentHeight;
                width = consoleWidth();
                applyScrollRegion(height);
                positionAtRegionBottom(height);
            }
            drawStatusLine(statusLine, width, height);
        } else {
            SetConsoleTitleW((statusLine + L" - OI-Code").c_str());
        }
    }
    const ULONGLONG elapsedMilliseconds = GetTickCount64() - startTick;

    FILETIME creationTime{}, exitTime{}, kernelTime{}, userTime{};
    unsigned long long cpuMilliseconds = 0;
    if (GetProcessTimes(processInfo.hProcess, &creationTime, &exitTime, &kernelTime, &userTime)) {
        cpuMilliseconds = fileTimeToMilliseconds(kernelTime) + fileTimeToMilliseconds(userTime);
    }
    SIZE_T peakMemory = 0;
    PROCESS_MEMORY_COUNTERS counters{};
    if (GetProcessMemoryInfo(processInfo.hProcess, &counters, sizeof(counters))) {
        peakMemory = counters.PeakWorkingSetSize;
    }
    DWORD exitCode = 0;
    GetExitCodeProcess(processInfo.hProcess, &exitCode);
    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);

    if (vt) {
        resetScrollRegion();
        drawStatusLine(L"", width, height);
    }
    SetConsoleTitleW((displayName + L" - OI-Code").c_str());
    printLine(L"");
    printLine(L"--------------");
    wchar_t buffer[256];
    swprintf(buffer, 256, L"运行时间: %.3fs", static_cast<double>(elapsedMilliseconds) / 1000.0);
    printLine(buffer);
    swprintf(buffer, 256, L"峰值内存: %.1fMB", static_cast<double>(peakMemory) / (1024.0 * 1024.0));
    printLine(buffer);
    swprintf(buffer, 256, L"CPU 时间: %llums", cpuMilliseconds);
    printLine(buffer);
    if (exitCode != 0) {
        swprintf(buffer, 256, L"退出码: %lu", exitCode);
        printLine(buffer);
    }

    pauseForAnyKey();
    return 0;
}
`;
