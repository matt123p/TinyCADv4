// TinyCAD's process/worker bridge for the ngspice shared API (protocol 1).
#include "ngspice/sharedspice.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
EM_JS(void, send_event, (const char* json), { globalThis.ngspiceEmit(UTF8ToString(json)); });
#elif defined(_WIN32)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace {
using Init = int (*)(SendChar*, SendStat*, ControlledExit*, SendData*, SendInitData*, BGThreadRunning*, void*);
using Circuit = int (*)(char**);
using Command = int (*)(char*);
Init init;
Circuit circuit;
Command command;
std::mutex output_mutex;
std::atomic<bool> stopped{false}, failed{false};
std::size_t bytes = 0, log_bytes = 0;
std::vector<std::vector<double>> rows, imaginary;
std::string escape(const std::string& s) {
  std::ostringstream o; o << '"';
  for (unsigned char c : s) {
    switch(c) {
      case '"': o << "\\\""; break; case '\\': o << "\\\\"; break;
      case '\n': o << "\\n"; break; case '\r': o << "\\r"; break; case '\t': o << "\\t"; break;
      default: if(c < 32) o << "\\u" << std::hex << std::setw(4) << std::setfill('0') << int(c) << std::dec; else o << c;
    }
  }
  return o.str() + '"';
}
void emit(const std::string& value) {
  std::lock_guard<std::mutex> guard(output_mutex);
#ifdef __EMSCRIPTEN__
  send_event(value.c_str());
#else
  std::cout << value << '\n' << std::flush;
#endif
}
std::string matrix(const std::vector<std::vector<double>>& values) {
  std::ostringstream o; o << '[' << std::setprecision(17);
  for (std::size_t i=0;i<values.size();++i) {
    if(i) o << ','; o << '[';
    for (std::size_t j=0;j<values[i].size();++j) { if(j) o << ','; o << values[i][j]; }
    o << ']';
  }
  return o.str()+']';
}
void flush() {
  if(rows.empty()) return;
  emit("{\"type\":\"data\",\"rows\":"+matrix(rows)+",\"imaginary\":"+matrix(imaginary)+"}");
  rows.clear(); imaginary.clear();
}
int log(char* message, int, void*) {
  const std::string s = message ? message : "";
  if(log_bytes + s.size() <= 2*1024*1024) { log_bytes += s.size(); emit("{\"type\":\"log\",\"message\":"+escape(s)+"}"); }
  if(s.find("Error:") != std::string::npos || s.find("Fatal error") != std::string::npos) failed=true;
  return 0;
}
int status(char*, int, void*) { return 0; }
int exiting(int code, NG_BOOL, NG_BOOL, int, void*) { if(code) failed=true; return 0; }
int background(NG_BOOL, int, void*) { return 0; }
int definitions(pvecinfoall info, int, void*) {
  flush();
  if(info->veccount > 128) { failed=true; emit("{\"type\":\"finished\",\"state\":\"failed\",\"error\":\"Too many output vectors (maximum 128).\"}"); return 1; }
  std::string s="{\"type\":\"vectors\",\"names\":[";
  for(int i=0;i<info->veccount;++i) { if(i) s+=','; s+=escape(info->vecs[i]->vecname); }
  emit(s+"]}"); return 0;
}
int data(pvecvaluesall info, int, int, void*) {
  if(failed || info->veccount>128 || info->veccount<1) return 0;
  bytes += std::size_t(info->veccount)*16;
  if(bytes>64*1024*1024) {
    failed=true; flush();
    emit("{\"type\":\"finished\",\"state\":\"failed\",\"error\":\"Numerical data limit reached (64 MiB).\"}");
    return 0;
  }
  std::vector<double> r, im;
  for(int i=0;i<info->veccount;++i) {
    auto v=info->vecsa[i];
    if(!std::isfinite(v->creal) || (v->is_complex && !std::isfinite(v->cimag))) { failed=true; emit("{\"type\":\"finished\",\"state\":\"failed\",\"error\":\"The solver produced a non-finite value.\"}"); return 0; }
    r.push_back(v->creal); im.push_back(v->is_complex ? v->cimag : 0);
  }
  rows.push_back(std::move(r)); imaginary.push_back(std::move(im));
  if(rows.size()>=256) flush();
  return 0;
}
int execute(const std::string& s) { std::vector<char> b(s.begin(),s.end()); b.push_back(0); return command(b.data()); }
int run(const std::string& deck) {
  std::vector<std::string> lines; std::istringstream input(deck); std::string line;
  while(std::getline(input,line)) { if(!line.empty() && line.back()=='\r') line.pop_back(); lines.push_back(line); }
  std::vector<char*> pointers; for(auto& l:lines) pointers.push_back(l.data()); pointers.push_back(nullptr);
  if(circuit(pointers.data())) failed=true;
  if(!failed && execute("run")) failed=true;
  flush();
  emit(std::string("{\"type\":\"finished\",\"state\":\"")+(stopped?"stopped":failed?"failed":"complete")+"\"}");
  return failed ? 1 : 0;
}
}

#ifdef __EMSCRIPTEN__
extern "C" EMSCRIPTEN_KEEPALIVE int tc_run(const char* deck) {
  init=ngSpice_Init; circuit=ngSpice_Circ; command=ngSpice_Command;
  ngSpice_nospinit(); ngSpice_nospiceinit();
  init(log,status,exiting,data,definitions,background,nullptr);
  return run(deck);
}
#else
int main(int argc,char** argv) {
  if(argc<3) { std::cerr << "Expected library path and deck path\n"; return 2; }
#ifdef _WIN32
  SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32 | LOAD_LIBRARY_SEARCH_USER_DIRS);
  // The broker stages Windows dependencies under ASCII relative names in the
  // private job cwd. Resolve against the wide cwd so Unicode user directories
  // do not pass through ngspice's narrow-character model-loader API.
  const int length=MultiByteToWideChar(CP_UTF8,0,argv[1],-1,nullptr,0);
  if(length<1) return 3;
  std::vector<wchar_t> wide(length); MultiByteToWideChar(CP_UTF8,0,argv[1],-1,wide.data(),length);
  const DWORD required=GetFullPathNameW(wide.data(),0,nullptr,nullptr);
  std::vector<wchar_t> absolute(required+1);
  if(!GetFullPathNameW(wide.data(),DWORD(absolute.size()),absolute.data(),nullptr)) return 3;
  const auto library=LoadLibraryExW(absolute.data(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);
  auto symbol=[&](const char* n){return reinterpret_cast<void*>(GetProcAddress(library,n));};
#else
  const auto library=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);
  auto symbol=[&](const char* n){return dlsym(library,n);};
#endif
  if(!library) { std::cerr << "Cannot load bundled ngspice library\n"; return 3; }
  init=reinterpret_cast<Init>(symbol("ngSpice_Init"));
  circuit=reinterpret_cast<Circuit>(symbol("ngSpice_Circ"));
  command=reinterpret_cast<Command>(symbol("ngSpice_Command"));
  auto noinit=reinterpret_cast<void(*)()>(symbol("ngSpice_nospinit"));
  auto nouser=reinterpret_cast<void(*)()>(symbol("ngSpice_nospiceinit"));
  if(!init || !circuit || !command || !noinit || !nouser) return 4;
  noinit(); nouser(); init(log,status,exiting,data,definitions,background,nullptr);
  for(int i=3;i<argc;++i) {
    std::string p=argv[i];
#ifdef _WIN32
    std::replace(p.begin(),p.end(),'\\','/');
#endif
    if(p.find('"')!=std::string::npos || p.find('\n')!=std::string::npos) return 5;
    if(execute("codemodel \""+p+"\"")) return 6;
  }
  std::ifstream file(argv[2]); if(!file) return 7;
  std::ostringstream deck; deck << file.rdbuf();
  // The parent can terminate this dedicated process without entering the solver
  // reentrantly. Accepted callback chunks remain in the application's store.
  return run(deck.str());
}
#endif
