package br.com.ueslei.enviau1;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * App simples para enviar G-code para a Snapmaker U1 (Klipper + Moonraker) pela rede local.
 * A interface fica em assets/index.html; esta classe faz o trabalho de rede (sem restricoes de CORS).
 */
public class MainActivity extends Activity {

    private static final int PICK_FILE = 42;
    private static final int PORTA = 7125;

    private WebView web;
    private SharedPreferences prefs;
    private Uri arquivoUri;
    private String arquivoNome;
    private long arquivoTamanho = -1;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private volatile boolean enviando = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("config", MODE_PRIVATE);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                if (arquivoNome != null) avisarArquivo();
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Ponte(), "Android");
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
        tratarIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        tratarIntent(intent);
    }

    private void tratarIntent(Intent intent) {
        if (intent == null) return;
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri != null) {
            escolherUri(uri);
            avisarArquivo();
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && resultCode == RESULT_OK && data != null && data.getData() != null) {
            escolherUri(data.getData());
            avisarArquivo();
        }
    }

    private void escolherUri(Uri uri) {
        arquivoUri = uri;
        arquivoNome = "arquivo.gcode";
        arquivoTamanho = -1;
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int iN = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int iT = c.getColumnIndex(OpenableColumns.SIZE);
                if (iN >= 0 && c.getString(iN) != null) arquivoNome = c.getString(iN);
                if (iT >= 0 && !c.isNull(iT)) arquivoTamanho = c.getLong(iT);
            }
        } catch (Exception ignored) {
            String p = uri.getLastPathSegment();
            if (p != null) arquivoNome = p.substring(p.lastIndexOf('/') + 1);
        }
    }

    private void avisarArquivo() {
        js("onFilePicked(" + JSONObject.quote(arquivoNome) + "," + arquivoTamanho + ")");
    }

    private void js(final String codigo) {
        runOnUiThread(() -> web.evaluateJavascript(codigo, null));
    }

    private String base() {
        String ip = prefs.getString("ip", "").trim();
        if (ip.startsWith("http://") || ip.startsWith("https://")) return ip.replaceAll("/+$", "");
        if (ip.contains(":")) return "http://" + ip;
        return "http://" + ip + ":" + PORTA;
    }

    private HttpURLConnection abrir(String url, String metodo, int timeout) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(metodo);
        c.setConnectTimeout(timeout);
        c.setReadTimeout(Math.max(timeout, 15000));
        String chave = prefs.getString("apikey", "").trim();
        if (!chave.isEmpty()) c.setRequestProperty("X-Api-Key", chave);
        return c;
    }

    private static String ler(HttpURLConnection c) {
        try {
            InputStream in = c.getResponseCode() >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in == null) return "";
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) bo.write(b, 0, n);
            in.close();
            return bo.toString("UTF-8");
        } catch (Exception e) {
            return "";
        }
    }

    /** Metodos chamados pelo JavaScript da tela. */
    private class Ponte {

        @JavascriptInterface
        public String getConfig() {
            try {
                JSONObject o = new JSONObject();
                o.put("ip", prefs.getString("ip", ""));
                o.put("apikey", prefs.getString("apikey", ""));
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public void setConfig(String ip, String apikey) {
            prefs.edit().putString("ip", ip == null ? "" : ip.trim())
                    .putString("apikey", apikey == null ? "" : apikey.trim()).apply();
        }

        /** Requisicao generica ao Moonraker. Resposta chega em onResp(id, status, texto). */
        @JavascriptInterface
        public void request(final String id, final String metodo, final String caminho) {
            pool.execute(() -> {
                int status = 0;
                String texto;
                try {
                    HttpURLConnection c = abrir(base() + caminho, metodo, 5000);
                    if ("POST".equals(metodo)) {
                        c.setDoOutput(true);
                        c.setFixedLengthStreamingMode(0);
                        c.getOutputStream().close();
                    }
                    status = c.getResponseCode();
                    texto = ler(c);
                    c.disconnect();
                } catch (Exception e) {
                    texto = e.getClass().getSimpleName() + ": " + e.getMessage();
                }
                js("onResp(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(texto) + ")");
            });
        }

        @JavascriptInterface
        public void pickFile() {
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            runOnUiThread(() -> startActivityForResult(i, PICK_FILE));
        }

        @JavascriptInterface
        public void upload(final String nomeDestino, final boolean imprimir) {
            if (arquivoUri == null || enviando) return;
            enviando = true;
            pool.execute(() -> {
                int status = 0;
                String texto;
                String limite = "----EnviaU1" + System.currentTimeMillis();
                try {
                    ContentResolver cr = getContentResolver();
                    long tamanho = arquivoTamanho;
                    if (tamanho < 0) {
                        // descobre o tamanho lendo o arquivo uma vez
                        tamanho = 0;
                        try (InputStream in = cr.openInputStream(arquivoUri)) {
                            byte[] b = new byte[65536];
                            int n;
                            while ((n = in.read(b)) > 0) tamanho += n;
                        }
                    }
                    String nome = nomeDestino.replace("\"", "");
                    StringBuilder cab = new StringBuilder();
                    cab.append("--").append(limite).append("\r\n")
                       .append("Content-Disposition: form-data; name=\"root\"\r\n\r\ngcodes\r\n");
                    if (imprimir) {
                        cab.append("--").append(limite).append("\r\n")
                           .append("Content-Disposition: form-data; name=\"print\"\r\n\r\ntrue\r\n");
                    }
                    cab.append("--").append(limite).append("\r\n")
                       .append("Content-Disposition: form-data; name=\"file\"; filename=\"").append(nome).append("\"\r\n")
                       .append("Content-Type: application/octet-stream\r\n\r\n");
                    byte[] ini = cab.toString().getBytes(StandardCharsets.UTF_8);
                    byte[] fim = ("\r\n--" + limite + "--\r\n").getBytes(StandardCharsets.UTF_8);

                    HttpURLConnection c = abrir(base() + "/server/files/upload", "POST", 8000);
                    c.setReadTimeout(120000);
                    c.setDoOutput(true);
                    c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + limite);
                    c.setFixedLengthStreamingMode(ini.length + tamanho + fim.length);
                    try (OutputStream out = c.getOutputStream(); InputStream in = cr.openInputStream(arquivoUri)) {
                        out.write(ini);
                        byte[] b = new byte[65536];
                        long enviado = 0;
                        int n, ultimo = -1;
                        while ((n = in.read(b)) > 0) {
                            out.write(b, 0, n);
                            enviado += n;
                            int pct = (int) (enviado * 100 / Math.max(1, tamanho));
                            if (pct != ultimo) {
                                ultimo = pct;
                                js("onUploadProgress(" + pct + ")");
                            }
                        }
                        out.write(fim);
                    }
                    status = c.getResponseCode();
                    texto = ler(c);
                    c.disconnect();
                } catch (Exception e) {
                    texto = e.getClass().getSimpleName() + ": " + e.getMessage();
                }
                enviando = false;
                js("onUploadDone(" + status + "," + JSONObject.quote(texto) + ")");
            });
        }

        /** Procura a impressora na rede Wi-Fi (porta 7125). */
        @JavascriptInterface
        public void scan() {
            pool.execute(() -> {
                String prefixo = null;
                try {
                    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    int ip = wm.getConnectionInfo().getIpAddress();
                    if (ip != 0) {
                        prefixo = (ip & 0xff) + "." + ((ip >> 8) & 0xff) + "." + ((ip >> 16) & 0xff) + ".";
                    }
                } catch (Exception ignored) { }
                if (prefixo == null) {
                    js("onScanDone(0," + JSONObject.quote("Não consegui ler o IP do Wi-Fi. Conecte o celular no Wi-Fi da impressora.") + ")");
                    return;
                }
                final String pre = prefixo;
                final AtomicInteger achados = new AtomicInteger();
                ExecutorService varredura = Executors.newFixedThreadPool(32);
                for (int i = 1; i < 255; i++) {
                    final String alvo = pre + i;
                    varredura.execute(() -> {
                        try {
                            HttpURLConnection c = (HttpURLConnection) new URL("http://" + alvo + ":" + PORTA + "/server/info").openConnection();
                            c.setConnectTimeout(700);
                            c.setReadTimeout(1500);
                            int st = c.getResponseCode();
                            String corpo = ler(c);
                            c.disconnect();
                            if (st == 200 || st == 401 || st == 403 || corpo.contains("klippy")) {
                                achados.incrementAndGet();
                                js("onScanFound(" + JSONObject.quote(alvo) + "," + st + ")");
                            }
                        } catch (Exception ignored) { }
                    });
                }
                varredura.shutdown();
                try { varredura.awaitTermination(60, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
                js("onScanDone(" + achados.get() + "," + JSONObject.quote(pre + "x") + ")");
            });
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public String printerWebUrl() {
            String b = base();
            return b.replace(":" + PORTA, "");
        }
    }
}
