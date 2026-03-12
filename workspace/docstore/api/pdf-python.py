"""
Vercel Python 서버리스 함수 — Python PDF 로더 실행기

Node.js 서버에서 이 함수를 HTTP로 호출하여 Python PDF 로더를 실행한다.

지원 형식:
  1. multipart/form-data — file + loader (소용량, 4.5MB 이하)
  2. application/json — { loader, downloadUrl } (대용량, URL로 다운로드)
"""

from http.server import BaseHTTPRequestHandler
import json
import tempfile
import os
import cgi
import urllib.request


def extract_pymupdf(pdf_path):
    import pymupdf
    doc = pymupdf.open(pdf_path)
    pages = []
    all_text = []
    for i, page in enumerate(doc):
        text = page.get_text("text")
        pages.append({"pageNumber": i + 1, "text": text.strip()})
        all_text.append(text)
    doc.close()
    return {"pages": pages, "totalPages": len(pages), "fullText": "\n\n".join(all_text)}


def extract_pypdf(pdf_path):
    from pypdf import PdfReader
    reader = PdfReader(pdf_path)
    pages = []
    all_text = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        pages.append({"pageNumber": i + 1, "text": text.strip()})
        all_text.append(text)
    return {"pages": pages, "totalPages": len(pages), "fullText": "\n\n".join(all_text)}


def extract_pdfplumber(pdf_path):
    import pdfplumber
    pages = []
    all_text = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            tables = page.extract_tables()
            if tables:
                table_texts = []
                for table in tables:
                    if not table:
                        continue
                    header = table[0] if table else []
                    rows = table[1:] if len(table) > 1 else []
                    md = "| " + " | ".join(str(c or "") for c in header) + " |"
                    md += "\n| " + " | ".join("---" for _ in header) + " |"
                    for row in rows:
                        md += "\n| " + " | ".join(str(c or "") for c in row) + " |"
                    table_texts.append(md)
                plain_text = page.extract_text() or ""
                text = plain_text + "\n\n" + "\n\n".join(table_texts)
            else:
                text = page.extract_text() or ""
            pages.append({"pageNumber": i + 1, "text": text.strip()})
            all_text.append(text)
    return {"pages": pages, "totalPages": len(pages), "fullText": "\n\n".join(all_text)}


LOADERS = {
    "pymupdf": extract_pymupdf,
    "pypdf": extract_pypdf,
    "pdfplumber": extract_pdfplumber,
}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_type = self.headers.get('Content-Type', '')

            if 'application/json' in content_type:
                # JSON 방식: { loader, downloadUrl } — 대용량 파일
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                data = json.loads(body)

                loader_id = data.get('loader', 'pymupdf')
                download_url = data.get('downloadUrl')

                if not download_url:
                    self._send_json(400, {"error": "downloadUrl이 필요합니다."})
                    return

                if loader_id not in LOADERS:
                    self._send_json(400, {"error": f"알 수 없는 로더: {loader_id}"})
                    return

                # URL에서 PDF 다운로드 → 임시 파일 저장
                with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                    with urllib.request.urlopen(download_url) as response:
                        tmp.write(response.read())
                    tmp_path = tmp.name

                try:
                    result = LOADERS[loader_id](tmp_path)
                    self._send_json(200, result)
                finally:
                    os.unlink(tmp_path)

            elif 'multipart/form-data' in content_type:
                # multipart 방식: file + loader — 소용량 파일
                form = cgi.FieldStorage(
                    fp=self.rfile,
                    headers=self.headers,
                    environ={'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': content_type}
                )

                loader_id = form.getfirst('loader', 'pymupdf')
                file_item = form['file']

                if not file_item.file:
                    self._send_json(400, {"error": "PDF 파일이 필요합니다."})
                    return

                if loader_id not in LOADERS:
                    self._send_json(400, {"error": f"알 수 없는 로더: {loader_id}"})
                    return

                with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                    tmp.write(file_item.file.read())
                    tmp_path = tmp.name

                try:
                    result = LOADERS[loader_id](tmp_path)
                    self._send_json(200, result)
                finally:
                    os.unlink(tmp_path)

            else:
                self._send_json(400, {"error": "application/json 또는 multipart/form-data 형식이 필요합니다."})

        except ImportError as e:
            self._send_json(500, {"error": f"패키지 미설치: {str(e)}"})
        except Exception as e:
            self._send_json(500, {"error": f"처리 오류: {str(e)}"})

    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))
