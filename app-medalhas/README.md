# Forja 3D — foto vira medalha, chaveiro ou troféu

App Android que transforma uma **foto ou logo** em uma peça para impressão 3D multicolor. **Funciona sem internet**: todo o processamento acontece no celular, e o app nem pede permissão de internet.

## Como funciona
1. **Imagem:** escolha da galeria ou use "Compartilhar → Forja 3D" em outro app.
2. **Fundo:** o app separa o fundo (transparência ou cor das bordas) e acha a silhueta.
3. **Cores:** agrupa as cores em 2, 3 ou 4. A cor **base** vira o corpo da peça (filamento 1) e as outras ficam em relevo (filamentos 2 a 4).
4. **Peça:**
   - **Medalha** (70 mm): alça com fenda para fita de 26 mm
   - **Chaveiro** (45 mm): argola com furo de 5,2 mm
   - **Troféu** (100 mm): placa com pino e base separada com encaixe
   - Formato: **contorno do logo** ou **redonda**
5. **Exportar:**
   - **3MF multicolor** no formato do PrusaSlicer, que PrusaSlicer, OrcaSlicer, Snapmaker Orca e Bambu Studio leem. Cada cor já vem no seu filamento.
   - **STL** de uma cor só.

Ajustes: largura, espessura da base (padrão 3 mm), altura do relevo (padrão 0,6 mm) e sensibilidade da separação do fundo.

## Dicas
- Funciona melhor com **logos e desenhos de cores chapadas**. Fotos comuns (pessoas, paisagens) viram manchas de cor.
- Se o fundo "vazar" para dentro do logo, diminua a **separação do fundo**. Se sobrar fundo, aumente.
- Toque em **"Usar como base"** para trocar qual cor forma o corpo da peça.

## Estrutura
- `assets/motor.js`: processamento de imagem, contornos, geometria 2D (Clipper), malha 3D (earcut) e exportação 3MF/STL
- `assets/app.js` e `assets/index.html`: tela e visualização 3D (three.js)
- `assets/lib/`: three.js r158, earcut 2.2.4 e clipper-lib 6.4.2, embutidos para funcionar offline (licenças MIT e Boost)
- `src/.../MainActivity.java`: WebView, escolha de imagem, "Compartilhar" e salvamento de arquivos

## Compilar
`./build.sh` gera o `Forja3D.apk`. Precisa do Android SDK (platform 34 e build-tools 36) e do JDK, e não usa Gradle.
