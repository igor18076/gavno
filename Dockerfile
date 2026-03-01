FROM python:3.12-slim

WORKDIR /app

COPY python_app/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY public ./public
COPY data ./data
COPY python_app ./python_app

ENV PYTHONUNBUFFERED=1
ENV PORT=3000
EXPOSE 3000

CMD ["python", "python_app/app.py"]
