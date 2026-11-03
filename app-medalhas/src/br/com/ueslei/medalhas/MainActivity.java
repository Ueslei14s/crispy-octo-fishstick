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

    private class Ponte {
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
