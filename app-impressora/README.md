# Envia U1 — app Android para a Snapmaker U1

App simples para **enviar G-code do celular para a Snapmaker U1 pela rede Wi-Fi** e acompanhar a impressão.
Ele conversa direto com o Moonraker da impressora (porta 7125), o mesmo serviço que o Fluidd e o Snapmaker Orca usam.

## O que o app faz
- Procura a impressora na rede ou aceita o IP digitado
- Envia um arquivo `.gcode` e, se você quiser, já começa a imprimir
- Mostra o status, o progresso, o tempo restante e as temperaturas das 4 cabeças e da mesa
- Pausa, continua e cancela a impressão
- Lista os arquivos que já estão na impressora e imprime qualquer um deles
- Recebe arquivos pelo **"Compartilhar"** ou **"Abrir com"** de outros apps (WhatsApp, Arquivos, Chrome)
- O botão **Fluidd** abre o painel completo da impressora no navegador

> O app **não fatia** arquivos 3MF/STL. Ele envia arquivos `.gcode` já fatiados para a U1.

## Como instalar
1. Baixe o `EnviaU1.apk` no celular.
2. Toque no arquivo. Se o Android pedir, permita **"Instalar apps desconhecidos"** para o app que abriu o APK (Chrome, Arquivos etc.).
3. Se o Play Protect avisar que o app é desconhecido, toque em **"Mais detalhes" → "Instalar mesmo assim"**. O aviso aparece porque o app não veio da Play Store.

## Como usar
1. Deixe o celular no **mesmo Wi-Fi** da impressora. A U1 só funciona em 2,4 GHz.
2. Toque em **Procurar na rede**, ou digite o IP que aparece na tela da U1 (Configurações → Wi-Fi), e toque em **Conectar**.
3. Toque em **Escolher arquivo**, selecione o `.gcode` e depois **Enviar para a impressora**.

## Problemas comuns
- **"Sem resposta da impressora"**: confira o IP e se o celular está no mesmo Wi-Fi, e não nos dados móveis nem numa rede de convidados.
- **Erro 401/403**: a impressora não autorizou o celular. Isso acontece em redes com faixa de IP incomum. Na seção `[authorization]` do `moonraker.conf`, a lista `trusted_clients` precisa incluir a faixa da sua rede. Também dá para gerar uma chave de API e colar em **Avançado**.

## Compilar
Precisa do Android SDK (platform 34 e build-tools 36) e do JDK. Rode `./build.sh`, que gera o `EnviaU1.apk` sem usar Gradle.
A chave de assinatura (`chave-envia-u1.jks`) não fica no repositório. Se outra chave for usada numa versão nova, desinstale a versão antiga antes de instalar.
