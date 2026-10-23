"""Assert actual raster output and PDF image geometry; no buyer data or real signature."""
import fitz,json,sys
from pathlib import Path
folder=Path(sys.argv[1] if len(sys.argv)>1 else 'docs/deploy/20261023-pickup-logo-hotfix');phase=sys.argv[2] if len(sys.argv)>2 else 'after';failures=[];results=[];unit=72/25.4
for file in sorted(folder.glob(f'{phase}-*.pdf')):
 doc=fitz.open(file);page=doc[0];pix=page.get_pixmap(matrix=fitz.Matrix(3,3),alpha=False);pix.save(str(file.with_suffix('.png')))
 images=page.get_image_info();logo=next(i for i in images if i['bbox'][1]<23*unit);bbox=fitz.Rect(logo['bbox']);title=next(b for b in page.get_text('blocks') if 'JUSTIFICANTE DE RECOGIDA' in b[4]);title_box=fitz.Rect(title[:4]);overlap=bbox.intersects(title_box)
 if overlap:failures.append(file.name+': logo overlaps title')
 if bbox.width>30*unit+.02 or bbox.height>12*unit+.02:failures.append(file.name+': logo exceeds fixed contain box')
 raster=page.get_pixmap(matrix=fitz.Matrix(3,3),alpha=False);logo_corner=raster.pixel(round((bbox.x0+.3*unit)*3),round((bbox.y0+.3*unit)*3))
 if min(logo_corner)<245:failures.append(file.name+': transparent logo background is not white '+str(logo_corner))
 # Sender stamp is the right-hand image inside the printed sender box.
 stamp=next(i for i in images if i['bbox'][0]>110*unit);sb=fitz.Rect(stamp['bbox']);stamp_corner=raster.pixel(round((sb.x0+.3*unit)*3),round((sb.y0+.3*unit)*3))
 if min(stamp_corner)<245:failures.append(file.name+': transparent stamp background is not white '+str(stamp_corner))
 if sb.x0<112*unit-.02 or sb.x1>168*unit+.02:failures.append(file.name+': stamp escapes sender inner edges')
 results.append({'file':file.name,'pages':len(doc),'logoBoxMm':[round(v/unit,3) for v in bbox],'titleBoxMm':[round(v/unit,3) for v in title_box],'overlap':overlap,'logoBackground':logo_corner,'stampBackground':stamp_corner})
 doc.close()
print(json.dumps({'phase':phase,'results':results,'failures':failures},indent=2))
if failures:sys.exit(1)
