// resenha-sysaudio: o som do PC MENOS o próprio Resenha, para a transmissão de tela.
//
// Problema: o "som do computador" da transmissão capturava todo o áudio que sai do PC, inclusive a voz
// dos amigos da call tocando no Resenha, e quem assistia ouvia a própria voz de volta.
// Solução (a mesma dos apps de call e do OBS): a captura de áudio de aplicativo do Windows
// (AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK) no modo "excluir a árvore de processos" do Resenha.
// Precisa do Windows 10 versão 2004 (build 19041) ou mais novo; senão, o app volta ao jeito antigo.
//
// Uso:    resenha-sysaudio.exe <pid do Resenha>
// Saída:  stdout = PCM 16 bits, 48 kHz, 2 canais, intercalado (cru, sem cabeçalho)
//         stderr = "ready" quando a captura começou, ou "error <passo> 0x<hr>" se não deu
// Fim:    quando o stdin fecha (o Resenha parou a transmissão ou fechou) ou a escrita falha.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <stdlib.h>

// estruturas de audioclientactivationparams.h (declaradas aqui para compilar também sem esse arquivo)
struct RsProcessLoopbackParams {
  DWORD TargetProcessId;
  DWORD ProcessLoopbackMode; // 1 = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
};
struct RsActivationParams {
  DWORD ActivationType; // 1 = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
  RsProcessLoopbackParams ProcessLoopbackParams;
};

static const GUID RS_IID_IAudioClient = {0x1CB9AD4C, 0xDBFA, 0x4c32, {0xB1, 0x78, 0xC2, 0xF5, 0x68, 0xA7, 0x03, 0xB2}};
static const GUID RS_IID_IAudioCaptureClient = {0xC8ADBD64, 0xE71E, 0x48a0, {0xA4, 0xDE, 0x18, 0x5C, 0x39, 0x5C, 0xD3, 0x17}};
static const GUID RS_IID_Handler = {0x41D949AB, 0x9862, 0x444A, {0x80, 0xF6, 0xC2, 0x61, 0x33, 0x4D, 0xA5, 0xEB}};
static const GUID RS_IID_IAgileObject = {0x94ea2b94, 0xe9cc, 0x49e0, {0xc0, 0xff, 0xee, 0x64, 0xca, 0x8f, 0x5b, 0x90}};
static const GUID RS_IID_IUnknown = {0x00000000, 0x0000, 0x0000, {0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}};

static void fail(const char* step, HRESULT hr) {
  fprintf(stderr, "error %s 0x%08lx\n", step, (unsigned long)hr);
  fflush(stderr);
  exit(1);
}

// O Windows avisa aqui quando a ativação termina (em outra thread; por isso "agile").
class Handler : public IActivateAudioInterfaceCompletionHandler {
 public:
  LONG refs = 1;
  HANDLE done = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  IAudioClient* client = nullptr;
  virtual ~Handler() { CloseHandle(done); }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** out) override {
    if (IsEqualGUID(riid, RS_IID_IUnknown) || IsEqualGUID(riid, RS_IID_Handler) || IsEqualGUID(riid, RS_IID_IAgileObject)) {
      *out = this;
      AddRef();
      return S_OK;
    }
    *out = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return InterlockedIncrement(&refs); }
  ULONG STDMETHODCALLTYPE Release() override {
    LONG n = InterlockedDecrement(&refs);
    if (n == 0) delete this;
    return n;
  }
  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* op) override {
    HRESULT hr = E_FAIL;
    IUnknown* unk = nullptr;
    HRESULT got = op->GetActivateResult(&hr, &unk);
    if (SUCCEEDED(got) && SUCCEEDED(hr) && unk) {
      result = unk->QueryInterface(RS_IID_IAudioClient, reinterpret_cast<void**>(&client));
      unk->Release();
    } else {
      result = FAILED(got) ? got : hr;
    }
    SetEvent(done);
    return S_OK;
  }
};

// o Resenha fecha o stdin para parar (e se ele morrer, o stdin também fecha)
static volatile LONG stopping = 0;
static DWORD WINAPI watchStdin(void*) {
  char buf[64];
  DWORD n;
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  while (ReadFile(in, buf, sizeof buf, &n, nullptr) && n > 0) {
  }
  InterlockedExchange(&stopping, 1);
  return 0;
}

int main(int argc, char** argv) {
  if (argc < 2) fail("args", E_INVALIDARG);
  const DWORD pid = static_cast<DWORD>(strtoul(argv[1], nullptr, 10));
  if (!pid) fail("pid", E_INVALIDARG);
  _setmode(_fileno(stdout), _O_BINARY);
  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);

  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) fail("com", hr);

  RsActivationParams params = {};
  params.ActivationType = 1;                                 // PROCESS_LOOPBACK
  params.ProcessLoopbackParams.TargetProcessId = pid;        // o Resenha (e todos os processos filhos dele)
  params.ProcessLoopbackParams.ProcessLoopbackMode = 1;      // EXCLUIR: tudo, menos o Resenha
  PROPVARIANT prop = {};
  prop.vt = VT_BLOB;
  prop.blob.cbSize = sizeof params;
  prop.blob.pBlobData = reinterpret_cast<BYTE*>(&params);

  Handler* handler = new Handler();
  IActivateAudioInterfaceAsyncOperation* op = nullptr;
  hr = ActivateAudioInterfaceAsync(L"VAD\\Process_Loopback", RS_IID_IAudioClient, &prop, handler, &op);
  if (FAILED(hr)) fail("activate", hr);
  if (WaitForSingleObject(handler->done, 5000) != WAIT_OBJECT_0) fail("activate-timeout", E_FAIL);
  if (op) op->Release();
  if (FAILED(handler->result) || !handler->client) fail("activate-result", handler->result);
  IAudioClient* client = handler->client;

  // a captura de aplicativo não tem formato próprio: pedimos 48 kHz, 16 bits, estéreo
  WAVEFORMATEX fmt = {};
  fmt.wFormatTag = WAVE_FORMAT_PCM;
  fmt.nChannels = 2;
  fmt.nSamplesPerSec = 48000;
  fmt.wBitsPerSample = 16;
  fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
  fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;
  const DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM;
  hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 200000 /* 20 ms */, 0, &fmt, nullptr);
  if (FAILED(hr)) fail("initialize", hr);

  IAudioCaptureClient* capture = nullptr;
  hr = client->GetService(RS_IID_IAudioCaptureClient, reinterpret_cast<void**>(&capture));
  if (FAILED(hr)) fail("capture-client", hr);
  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  hr = client->SetEventHandle(ready);
  if (FAILED(hr)) fail("event", hr);
  hr = client->Start();
  if (FAILED(hr)) fail("start", hr);
  CreateThread(nullptr, 0, watchStdin, nullptr, 0, nullptr);
  fprintf(stderr, "ready\n");
  fflush(stderr);

  static BYTE zeros[48000 * 4 / 10]; // até 100 ms de silêncio
  while (!stopping) {
    // sem som tocando, o Windows não manda pacotes: acorda de 100 em 100 ms mesmo assim
    WaitForSingleObject(ready, 100);
    UINT32 packet = 0;
    while (SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD bufFlags = 0;
      if (FAILED(capture->GetBuffer(&data, &frames, &bufFlags, nullptr, nullptr))) break;
      const DWORD bytes = frames * fmt.nBlockAlign;
      const BYTE* src = (bufFlags & AUDCLNT_BUFFERFLAGS_SILENT) && bytes <= sizeof zeros ? zeros : data;
      DWORD written = 0;
      const BOOL ok = WriteFile(out, src, bytes, &written, nullptr);
      capture->ReleaseBuffer(frames);
      if (!ok) {
        stopping = 1; // o Resenha fechou o outro lado
        break;
      }
    }
  }
  client->Stop();
  capture->Release();
  client->Release();
  CoUninitialize();
  return 0;
}
