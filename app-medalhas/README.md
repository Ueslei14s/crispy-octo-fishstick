# Forja 3D — foto vira medalha, chaveiro ou troféu

App Android que transforma uma **foto ou logo** em uma peça para impressão 3D multicolor. **Funciona sem internet**: todo o processamento acontece no celular, e o app nem pede permissão de internet.

## Como funciona
1. **Imagem:** escolha da galeria ou use "Compartilhar → Forja 3D" em outro app.
2. **Cores:** o app separa o fundo e agrupa as cores (2, 3 ou 4) pelo tom, então sombras ficam na cor certa. A cor **base** forma o corpo da peça (filamento 1) e as outras ficam em relevo (filamentos 2 a 4).
3. **Peça:**
   - **Medalha** (70 mm), com alça e fenda para fita de 26 mm
   - **Chaveiro** (45 mm), com argola
   - **Troféu** (100 mm): placa com pino de encaixe e **23 pedestais** (retangulares, redondos, ovais, hexagonais, octogonais, pentagonal, losango, estrela, pirâmide, tronco de cone, coluna clássica, pódio 1º 2º 3º, moldura…)
   - Formatos: **personalizado** (segue o contorno da arte), redondo, oval, hexagonal, octogonal, escudo e estrela
   - **Base preta** de 2, 3 ou 4 mm (ou qualquer valor) e altura do relevo das cores
4. **Otimizador (Snapmaker U1):**
   - qualidade 0,12, 0,16 ou 0,20 mm
   - **passar ferro** (desligado, todas as superfícies de cima, só a mais alta ou todas as sólidas), com fluxo, espaçamento e velocidade
   - paredes, camadas de topo e preenchimento
   - material de cada filamento (PLA, PLA Silk, PLA de alta velocidade e PETG)
   - botão **"recomendado"**: 0,12 mm, passar ferro em todas as superfícies de cima (12%, 0,12 mm, 30 mm/s), 3 paredes, 5 camadas de topo e 20% de preenchimento
5. **Exportar:**
   - **Projeto Snapmaker Orca (.3mf):** impressora U1, perfis oficiais (da pasta `resources/profiles/Snapmaker` do OrcaSlicer), as 4 cores, os materiais e todas as configurações do otimizador
   - **3MF universal:** formato multicolor do PrusaSlicer (PrusaSlicer, OrcaSlicer, Bambu Studio)
   - **STLs por cor (.zip):** um STL por filamento e um LEIA-ME. O formato STL não guarda cor, por isso vem um arquivo por cor

## Dicas
- Funciona melhor com **logos e desenhos de cores chapadas**. Fotos comuns (pessoas, paisagens) viram manchas de cor.
- Se o fundo "vazar" para dentro do logo, diminua a **separação do fundo**. Se sobrar fundo, aumente.
- Toque em **"Usar como base"** para trocar qual cor forma o corpo da peça.

## Estrutura
- `assets/motor.js`: processamento de imagem, contornos, geometria 2D (Clipper), malha 3D (earcut) e exportação 3MF/STL
- `assets/app.js` e `assets/index.html`: tela e visualização 3D (three.js)
- `assets/perfis_u1.js`: perfis da Snapmaker U1 (impressora, qualidades e filamentos), com a herança já resolvida
- `assets/lib/`: three.js r158, earcut 2.2.4 e clipper-lib 6.4.2, embutidos para funcionar offline (licenças MIT e Boost)
- `src/.../MainActivity.java`: WebView, escolha de imagem, "Compartilhar" e salvamento de arquivos

## Compilar
`./build.sh` gera o `Forja3D.apk`. Precisa do Android SDK (platform 34 e build-tools 36) e do JDK, e não usa Gradle.
