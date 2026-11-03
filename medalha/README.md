# Medalha Liga de Boxe Camaçari

Medalha multicolorida para a **Snapmaker U1** (4 cores), feita a partir do `logo.png`.

![prévia](preview.png)

- Tamanho: **70 x 70,5 mm**
- Base preta de **3 mm** com o formato do logo e borda de 1,5 mm
- Cores em relevo de **0,6 mm** sobre a base (espessura total de 3,6 mm)
- Alça no topo com **fenda de 26 x 4 mm** para fita de até 25 mm

## Arquivos
| Arquivo | Uso |
|---|---|
| `medalha_liga_boxe.3mf` | Um objeto com 4 partes: preto_base, vermelho, amarelo e branco |
| `stl/medalha_*.stl` | Uma STL por cor (alternativa ao 3MF) |
| `gerar_medalha.py` | Script que gera tudo; os parâmetros (tamanho, espessura, fenda) ficam no topo |

## Como fatiar (Snapmaker Orca)
1. Abra o `medalha_liga_boxe.3mf` e selecione a impressora **Snapmaker U1**.
2. Na lista de objetos, defina o filamento de cada parte: preto_base → preto, vermelho → vermelho, amarelo → amarelo, branco → branco.
3. Use camada de 0,2 mm, ou de 0,12–0,16 mm para detalhes mais nítidos, e imprima deitada, sem suportes.
