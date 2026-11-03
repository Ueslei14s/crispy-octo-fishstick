"""Gera a medalha 3D multicolorida a partir de logo.png.

Saidas:
  medalha_liga_boxe.3mf   -> 1 objeto com 4 partes (preto, vermelho, amarelo, branco)
  stl/*.stl               -> uma STL por cor
  preview.png             -> vista de cima

Uso: python3 gerar_medalha.py
"""
import zipfile
from pathlib import Path

import cv2
import numpy as np
import trimesh
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

# ---------------- parametros (mm) ----------------
LARGURA_MEDALHA = 70.0   # largura total da medalha
BASE = 3.0               # base preta
RELEVO = 0.6             # altura das cores sobre a base
BORDA = 1.5              # borda preta em volta do contorno do logo
FENDA_L, FENDA_A = 26.0, 4.0   # fenda para fita (largura x altura)
ALCA_L, ALCA_A = 34.0, 11.0    # alca onde fica a fenda
MIN_DETALHE = 0.35       # remove detalhes menores que isso (mm)

AQUI = Path(__file__).parent
img = cv2.imread(str(AQUI / "logo.png"))
h_img, w_img = img.shape[:2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
H, S, V = [hsv[..., i].astype(int) for i in range(3)]

mascaras = {
    "branco": (S < 70) & (V > 170),
    "amarelo": (H >= 16) & (H <= 40) & (S > 90) & (V > 120),
    "vermelho": ((H < 16) | (H >= 160)) & (S > 90) & (V > 70),
}

# silhueta do logo (tudo que nao e fundo), preenchida
logo = np.zeros((h_img, w_img), np.uint8)
for m in mascaras.values():
    logo[m] = 255
logo = cv2.morphologyEx(logo, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
cnts, _ = cv2.findContours(logo, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
cheio = np.zeros_like(logo)
cv2.drawContours(cheio, [c for c in cnts if cv2.contourArea(c) > 1500], -1, 255, -1)
xs = np.where(cheio.any(0))[0]
px_logo = xs.max() - xs.min()
MM = (LARGURA_MEDALHA - 2 * BORDA) / px_logo   # mm por pixel


def para_poligonos(mask):
    """mascara binaria -> geometria shapely em mm (y para cima)."""
    cnts, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        return Polygon()
    hier = hier[0]
    polys = []
    for i, c in enumerate(cnts):
        if hier[i][3] != -1 or len(c) < 3:
            continue
        ext = [(x * MM, (h_img - y) * MM) for x, y in c[:, 0]]
        furos = []
        j = hier[i][2]
        while j != -1:
            if len(cnts[j]) >= 3:
                furos.append([(x * MM, (h_img - y) * MM) for x, y in cnts[j][:, 0]])
            j = hier[j][0]
        polys.append(Polygon(ext, furos).buffer(0))
    return unary_union(polys).simplify(0.03)


def limpar(g):
    r = MIN_DETALHE / 2
    g = g.buffer(-r).buffer(r)          # tira linhas finas demais
    return g


contorno = para_poligonos(cheio).buffer(BORDA, join_style="round")

# alca com fenda para fita, acima da ponta da estrela
minx, miny, maxx, maxy = contorno.bounds
cx = (minx + maxx) / 2
topo_logo = maxy - BORDA
alca_y0 = topo_logo - 4.0               # sobrepoe a ponta da estrela
alca = box(cx - ALCA_L / 2, alca_y0, cx + ALCA_L / 2, alca_y0 + ALCA_A)
r = 3.5
alca = alca.buffer(-r).buffer(r)
fenda_y0 = alca_y0 + ALCA_A - 2.5 - FENDA_A
fenda = box(cx - FENDA_L / 2, fenda_y0, cx + FENDA_L / 2, fenda_y0 + FENDA_A).buffer(-1.2).buffer(1.2)
contorno = unary_union([contorno, alca]).difference(fenda)
if contorno.geom_type != "Polygon":
    print("AVISO: contorno com", len(contorno.geoms), "partes separadas")

cores = {}
ja_usado = Polygon()
for nome in ["branco", "amarelo", "vermelho"]:
    g = limpar(para_poligonos(mascaras[nome].astype(np.uint8) * 255))
    g = g.difference(ja_usado).difference(fenda.buffer(0.8)).intersection(contorno.buffer(-0.4))
    ja_usado = unary_union([ja_usado, g])
    cores[nome] = g


def extrudar(geom, z0, altura):
    partes = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    malhas = []
    for p in partes:
        if p.geom_type != "Polygon" or p.area < 0.05:
            continue
        m = trimesh.creation.extrude_polygon(p, altura)
        m.apply_translation([0, 0, z0])
        malhas.append(m)
    return trimesh.util.concatenate(malhas)


# centraliza na origem
dx, dy = -(contorno.bounds[0] + contorno.bounds[2]) / 2, -(contorno.bounds[1] + contorno.bounds[3]) / 2
malhas = {"preto_base": extrudar(contorno, 0, BASE)}
for nome, g in cores.items():
    malhas[nome] = extrudar(g, BASE, RELEVO)
for m in malhas.values():
    m.apply_translation([dx, dy, 0])
    m.merge_vertices()

(AQUI / "stl").mkdir(exist_ok=True)
for nome, m in malhas.items():
    m.export(AQUI / "stl" / f"medalha_{nome}.stl")

# ---------------- 3MF: 1 objeto com 4 partes ----------------
cores_hex = {"preto_base": "#111111FF", "vermelho": "#E3001BFF", "amarelo": "#FFD400FF", "branco": "#FFFFFFFF"}
nomes = list(malhas)
objs = []
for i, nome in enumerate(nomes, start=1):
    m = malhas[nome]
    vs = "".join(f'<vertex x="{x:.4f}" y="{y:.4f}" z="{z:.4f}"/>' for x, y, z in m.vertices)
    # cor em cada triangulo (lida por visualizadores 3MF em geral)
    ts = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}" pid="100" p1="{i-1}"/>' for a, b, c in m.faces)
    objs.append(f'<object id="{i}" name="{nome}" type="model" pid="100" pindex="{i-1}">'
                f'<mesh><vertices>{vs}</vertices><triangles>{ts}</triangles></mesh></object>')
comps = "".join(f'<component objectid="{i}"/>' for i in range(1, len(nomes) + 1))
pid = len(nomes) + 1

# Snapmaker Orca / OrcaSlicer / Bambu Studio leem o filamento de cada parte deste arquivo
FILAMENTO = {"preto_base": 1, "vermelho": 2, "amarelo": 3, "branco": 4}
partes_cfg = "".join(
    f'  <part id="{i}" subtype="normal_part">\n'
    f'    <metadata key="name" value="{nome}"/>\n'
    f'    <metadata key="extruder" value="{FILAMENTO[nome]}"/>\n'
    f'  </part>\n' for i, nome in enumerate(nomes, start=1))
model_settings = (f'<?xml version="1.0" encoding="UTF-8"?>\n<config>\n <object id="{pid}">\n'
                  f'  <metadata key="name" value="Medalha Liga de Boxe"/>\n'
                  f'  <metadata key="extruder" value="1"/>\n{partes_cfg} </object>\n</config>\n')
cor_xml = "".join(f'<base name="{n}" displaycolor="{cores_hex[n]}"/>' for n in nomes)
modelo = f'''<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">Medalha Liga de Boxe Camacari</metadata>
<resources><basematerials id="100">{cor_xml}</basematerials>
{"".join(objs)}
<object id="{pid}" name="Medalha Liga de Boxe" type="model"><components>{comps}</components></object>
</resources>
<build><item objectid="{pid}" transform="1 0 0 0 1 0 0 0 1 128 128 0"/></build>
</model>'''
with zipfile.ZipFile(AQUI / "medalha_liga_boxe.3mf", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
    z.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
    z.writestr("3D/3dmodel.model", modelo)
    z.writestr("Metadata/model_settings.config", model_settings)

# ---------------- GLB colorido (visualizadores 3D de celular) ----------------
cena = trimesh.Scene()
for nome, m in malhas.items():
    c = m.copy()
    rgba = [int(cores_hex[nome][k:k + 2], 16) for k in (1, 3, 5)] + [255]
    c.visual = trimesh.visual.ColorVisuals(c, face_colors=np.tile(rgba, (len(c.faces), 1)))
    cena.add_geometry(c, node_name=nome, geom_name=nome)
cena.export(AQUI / "medalha_colorida.glb")

# ---------------- preview ----------------
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import PathPatch
from matplotlib.path import Path as MPath

def desenhar(ax, geom, cor):
    partes = [geom] if geom.geom_type == "Polygon" else list(getattr(geom, "geoms", []))
    for p in partes:
        if p.geom_type != "Polygon" or p.is_empty:
            continue
        verts, codes = [], []
        for anel in [p.exterior, *p.interiors]:
            c = list(anel.coords)
            verts += c
            codes += [MPath.MOVETO] + [MPath.LINETO] * (len(c) - 2) + [MPath.CLOSEPOLY]
        ax.add_patch(PathPatch(MPath(np.array(verts) + [dx, dy], codes), fc=cor, ec="none"))

fig, ax = plt.subplots(figsize=(7, 8.5), dpi=150)
fig.patch.set_facecolor("#cfd6dd")
ax.set_facecolor("#cfd6dd")
desenhar(ax, contorno, "#111111")
desenhar(ax, cores["vermelho"], "#E3001B")
desenhar(ax, cores["amarelo"], "#FFD400")
desenhar(ax, cores["branco"], "#FFFFFF")
b = contorno.bounds
ax.set_xlim(b[0] + dx - 3, b[2] + dx + 3)
ax.set_ylim(b[1] + dy - 3, b[3] + dy + 3)
ax.set_aspect("equal")
ax.set_title(f"Medalha {b[2]-b[0]:.1f} x {b[3]-b[1]:.1f} mm | base {BASE} mm + relevo {RELEVO} mm")
fig.savefig(AQUI / "preview.png", bbox_inches="tight")

for nome, m in malhas.items():
    print(f"{nome:11s} estanque={m.is_watertight} volume={m.volume:8.1f} mm3")
print(f"tamanho: {b[2]-b[0]:.1f} x {b[3]-b[1]:.1f} mm, espessura {BASE+RELEVO} mm")
