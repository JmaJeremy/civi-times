FROM python:3

WORKDIR /usr/src/app

COPY requirements.txt ./
COPY google-chrome-stable_current_amd64.deb ./
RUN pip install --no-cache-dir -r requirements.txt
RUN apt-get update && apt-get install -y ./google-chrome-stable_current_amd64.deb

COPY . .

RUN apt-get install -y -f

CMD [ "python", "./main.py" ]
