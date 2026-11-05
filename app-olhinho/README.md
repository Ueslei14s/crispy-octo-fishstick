# Olhinho — babá eletrônica com dois celulares

App web instalável (PWA) que transforma um celular em **câmera** e outro em **monitor**, a distância.
Funciona em **Android e iPhone**, sem Play Store, sem conta e sem servidor próprio.

## O que faz
- Vídeo e áudio ao vivo, direto de celular para celular (WebRTC, criptografado)
- **Interfone**: segure o botão no monitor para falar com a criança
- **Alerta de barulho** com bipe, vibração e sensibilidade ajustável
- Visão noturna (realce de brilho), trocar câmera frontal/traseira pelo monitor, tela cheia
- Bateria da câmera visível no monitor; aviso quando está baixa
- Tela preta para economizar bateria (toque duas vezes para acender)
- Reconecta sozinho se o Wi-Fi ou a internet cair
- **Segurança**: código secreto de 16 caracteres (~79 bits) gerado no celular; a câmera mostra quantos monitores estão assistindo, avisa cada conexão, permite **bloquear novos acessos** e **gerar novo código**. Nada é gravado e o vídeo não passa por servidor.

## Como publicar (uma vez)
A câmera só abre por **https**. Publique a pasta `app-olhinho/` em qualquer hospedagem estática gratuita:
- **GitHub Pages**: Settings → Pages → Deploy from a branch → pasta `/app-olhinho` (ou copie para `/docs`)
- Netlify, Cloudflare Pages ou Vercel: arraste a pasta

## Como usar
1. Nos dois celulares, abra o endereço publicado.
   - **iPhone**: Safari → Compartilhar → **Adicionar à Tela de Início** (iOS 16.4 ou mais novo para manter a tela acesa).
   - **Android**: Chrome → menu → **Instalar app**.
2. No celular do quarto, toque em **Este celular é a CÂMERA** e permita câmera e microfone. Deixe no carregador, preso e fora do alcance da criança.
3. Toque em **Compartilhar** para mandar o link ao outro celular (ou digite o código).
4. No celular monitor, toque em **Conectar**.

## Limites que você precisa saber
- **O app precisa ficar aberto e com a tela ligada** nos dois celulares. Navegadores pausam apps em segundo plano, então sem isso não há alerta. Use "Escurecer" para poupar bateria.
- Em **4G/5G**, algumas operadoras bloqueiam a conexão direta. Se não conectar fora de casa, configure um servidor **TURN** em *Configurações avançadas* (há planos gratuitos, como Metered e Cloudflare).
- A sinalização usa o servidor público do PeerJS (só troca dados de conexão, nunca vídeo). Dá para usar um servidor próprio em *Configurações avançadas*.
- Não substitui a supervisão de um adulto.

## Testado
Dois navegadores Chromium com câmera/microfone simulados e servidor de sinalização local: conexão por código, vídeo 640×480, medidor de som, interfone, trocar câmera, alerta de barulho, queda e reconexão, bloqueio de acessos, link compartilhado e código errado. **Não foi testado em aparelhos reais**, então teste primeiro em casa, com os dois celulares no mesmo Wi-Fi e depois fora dele.

## Desenvolver
`python3 -m http.server 8080` dentro da pasta e abra `http://localhost:8080` (localhost conta como seguro para a câmera).
Para testar sem a internet: `npx peer --port 9000` e coloque `http://localhost:9000/` em *Configurações avançadas*.
