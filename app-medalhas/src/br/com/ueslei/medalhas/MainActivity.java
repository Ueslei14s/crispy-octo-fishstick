package br.com.ueslei.medalhas;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
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

/**
 * Forja 3D: transforma uma foto ou logo em medalha, chaveiro ou troféu para impressão 3D.
 * Todo o processamento acontece em assets/ (JavaScript), no próprio aparelho, sem internet.
 * Esta classe só cuida de escolher imagens, receber imagens compartilhadas e salvar arquivos.
 */
public class MainActivity extends Activity {

    private static final int ESCOLHER_IMAGEM = 1;
    private static final int SALVAR = 2;

    private WebView web;
    private ValueCallback<Uri[]> callbackArquivo;
    private byte[] pendente;
    private String pendenteNome;
    private Uri imagemCompartilhada;
    private boolean paginaPronta = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                paginaPronta = true;
                if (imagemCompartilhada != null) enviarImagem(imagemCompartilhada);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (callbackArquivo != null) callbackArquivo.onReceiveValue(null);
                callbackArquivo = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Escolher imagem"), ESCOLHER_IMAGEM);
                } catch (Exception e) {
                    callbackArquivo = null;
                    return false;
                }
                return true;
            }
        });
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
        if (Intent.ACTION_SEND.equals(intent.getAction())) uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        else if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        if (uri == null) return;
        imagemCompartilhada = uri;
        if (paginaPronta) enviarImagem(uri);
    }

    /** Lê a imagem compartilhada e entrega para a página como data URL. */
    private void enviarImagem(Uri uri) {
        imagemCompartilhada = null;
        new Thread(() -> {
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] b = new byte[65536];
                int n;
                while ((n = in.read(b)) > 0) bo.write(b, 0, n);
                String tipo = getContentResolver().getType(uri);
                String nome0 = nomeDe(uri);
                if (nome0.toLowerCase().endsWith(".3mf") || nome0.toLowerCase().endsWith(".stl") || (tipo != null && tipo.startsWith("model/"))) {
                    String b64 = Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
                    runOnUiThread(() -> web.evaluateJavascript("abrirModeloBase64(" + JSONObject.quote(b64) + "," + JSONObject.quote(nome0) + ")", null));
                    return;
                }
                if (tipo == null) tipo = "image/png";
                String url = "data:" + tipo + ";base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
                String nome = nomeDe(uri);
                runOnUiThread(() -> web.evaluateJavascript(
                        "abrirImagemDataUrl(" + JSONObject.quote(url) + "," + JSONObject.quote(nome) + ")", null));
            } catch (Exception e) {
                js("onSaved(false," + JSONObject.quote("Não consegui abrir a imagem compartilhada.") + ")");
            }
        }).start();
    }

    private String nomeDe(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (i >= 0 && c.getString(i) != null) return c.getString(i);
            }
        } catch (Exception ignored) { }
        return "peca";
    }

    private void js(String codigo) {
        runOnUiThread(() -> web.evaluateJavascript(codigo, null));
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == ESCOLHER_IMAGEM) {
            if (callbackArquivo != null) {
                Uri[] r = (res == RESULT_OK && data != null && data.getData() != null) ? new Uri[]{data.getData()} : null;
                callbackArquivo.onReceiveValue(r);
                callbackArquivo = null;
            }
        } else if (req == SALVAR) {
            if (res != RESULT_OK || data == null || data.getData() == null || pendente == null) {
                js("onSaved(false," + JSONObject.quote("Salvamento cancelado.") + ")");
                pendente = null;
                return;
            }
            final Uri destino = data.getData();
            final byte[] bytes = pendente;
            pendente = null;
            new Thread(() -> {
                try (OutputStream out = getContentResolver().openOutputStream(destino, "w")) {
                    out.write(bytes);
                    js("onSaved(true," + JSONObject.quote("Salvo: " + pendenteNome + " (" + (bytes.length / 1024) + " KB)") + ")");
                } catch (Exception e) {
                    js("onSaved(false," + JSONObject.quote("Erro ao salvar: " + e.getMessage()) + ")");
                }
            }).start();
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    private static String lerResposta(HttpURLConnection c) {
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

    private class Ponte {
        /** Requisição ao Moonraker da U1. Resposta em onResp2(id, status, texto). */
        @JavascriptInterface
        public void requisicao(String id, String metodo, String ip, String caminho) {
            new Thread(() -> {
                int status = 0;
                String texto;
                try {
                    String base = ip.trim();
                    if (!base.startsWith("http")) base = "http://" + base;
                    if (!base.substring(7).contains(":")) base = base + ":7125";
                    HttpURLConnection c = (HttpURLConnection) new URL(base + caminho).openConnection();
                    c.setRequestMethod(metodo);
                    c.setConnectTimeout(6000);
                    c.setReadTimeout(30000);
                    if ("POST".equals(metodo)) { c.setDoOutput(true); c.setFixedLengthStreamingMode(0); c.getOutputStream().close(); }
                    status = c.getResponseCode();
                    texto = lerResposta(c);
                    c.disconnect();
                } catch (Exception e) {
                    texto = e.getClass().getSimpleName() + ": " + e.getMessage();
                }
                js("onResp2(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(texto) + ")");
            }).start();
        }

        /** Envia o G-code para o Moonraker da U1 (porta 7125) e, se pedido, inicia a impressão. */
        @JavascriptInterface
        public void enviarGcode(String ip, String nome, String base64, boolean imprimir) {
            new Thread(() -> {
                int status = 0;
                String texto;
                try {
                    byte[] dados = Base64.decode(base64, Base64.DEFAULT);
                    String base = ip.trim();
                    if (!base.startsWith("http")) base = "http://" + base;
                    if (!base.substring(7).contains(":")) base = base + ":7125";
                    String limite = "----Forja3D" + System.currentTimeMillis();
                    StringBuilder cab = new StringBuilder();
                    cab.append("--").append(limite).append("\r\nContent-Disposition: form-data; name=\"root\"\r\n\r\ngcodes\r\n");
                    if (imprimir) cab.append("--").append(limite).append("\r\nContent-Disposition: form-data; name=\"print\"\r\n\r\ntrue\r\n");
                    cab.append("--").append(limite).append("\r\nContent-Disposition: form-data; name=\"file\"; filename=\"")
                       .append(nome.replace("\"", "")).append("\"\r\nContent-Type: application/octet-stream\r\n\r\n");
                    byte[] ini = cab.toString().getBytes(StandardCharsets.UTF_8);
                    byte[] fim = ("\r\n--" + limite + "--\r\n").getBytes(StandardCharsets.UTF_8);
                    HttpURLConnection c = (HttpURLConnection) new URL(base + "/server/files/upload").openConnection();
                    c.setRequestMethod("POST");
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(120000);
                    c.setDoOutput(true);
                    c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + limite);
                    c.setFixedLengthStreamingMode(ini.length + dados.length + fim.length);
                    try (OutputStream out = c.getOutputStream()) {
                        out.write(ini);
                        int ultimo = -1;
                        for (int i = 0; i < dados.length; i += 65536) {
                            int n = Math.min(65536, dados.length - i);
                            out.write(dados, i, n);
                            int pct = (int) ((long) (i + n) * 100 / dados.length);
                            if (pct != ultimo) { ultimo = pct; js("onEnvioProgresso(" + pct + ")"); }
                        }
                        out.write(fim);
                    }
                    status = c.getResponseCode();
                    texto = lerResposta(c);
                    c.disconnect();
                } catch (Exception e) {
                    texto = e.getClass().getSimpleName() + ": " + e.getMessage();
                }
                js("onEnvioFim(" + status + "," + JSONObject.quote(texto) + ")");
            }).start();
        }

        /** Recebe o arquivo em base64 e pergunta ao usuário onde salvar. */
        @JavascriptInterface
        public void saveFile(String nome, String mime, String base64) {
            try {
                pendente = Base64.decode(base64, Base64.DEFAULT);
            } catch (Exception e) {
                js("onSaved(false," + JSONObject.quote("Arquivo inválido.") + ")");
                return;
            }
            pendenteNome = nome;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("application/octet-stream");
            i.putExtra(Intent.EXTRA_TITLE, nome);
            runOnUiThread(() -> startActivityForResult(i, SALVAR));
        }
    }
}
