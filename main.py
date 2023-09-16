import requests
from bs4 import BeautifulSoup
from pprint import pprint
import re
import hashlib
import json
from datetime import datetime
from pymongo import MongoClient
from pymongo import errors
import sys
from selenium import webdriver
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service as ChromeService
from webdriver_manager.chrome import ChromeDriverManager
import time

#from PyQt6.QtWidgets import QApplication
#from PyQt6.QtCore import QUrl
#from PyQt6.QtWebEngineCore import QWebEnginePage

""" class Client(QWebEnginePage):
    def __init__(self, url):
        self.app = QApplication(sys.argv)
        QWebEnginePage.__init__(self)
        self.loadFinished.connect(self.on_page_load)
        self.mainFrame().load(QUrl(url))
        self.app.exec_()

    def on_page_load(self):
        self.app.quit() """

def scrape_barrie():
    URL = "https://barrie.legistar.com/Calendar.aspx"
    page = requests.get(URL)

    soup = BeautifulSoup(page.content, "html.parser")

    results = soup.find(id="ctl00_ContentPlaceHolder1_gridCalendar_ctl00")

    #print(results.prettify())

    event_elements = results.find_all(True, {'class': ['rgRow', 'rgAltRow']})

    #pprint(event_elements)
    events = []

    for event_element in event_elements:
        event = {}
        event['name'] = event_element.find("a", id=re.compile('.*hypBody')).text.strip()
        event['date'] = event_element.find("td", class_="rgSorted").text.strip()
        event['time'] = event_element.find("span", id=re.compile('.*lblTime')).text.strip()
        event['link'] = "https://barrie.legistar.com/" + str(event_element.find("a", id=re.compile('.*hypMeetingDetail')).get("href")).strip()

        event['key'] = hashlib.sha256(json.dumps(event, sort_keys=True).encode('utf-8')).hexdigest()

        if event['date'] and event['time']:
            dt_str = event['date'] + " " + event['time']        
        elif event['date']:
            dt_str = event['date'] + " 12:00 AM"
        
        print(dt_str)
        dt = datetime.strptime(dt_str, '%m/%d/%Y %I:%M %p')
        event['timestamp'] = dt
        event['group'] = "barrie"
        event['tags'] = ["city_council"]

        events.append(event)
        #pprint(event)

    pprint(events)
    return events

def scrape_simcoe():
    now = datetime.now()
    month_num = int(now.strftime("%-m"))
    month_num_adj = month_num - 1

    URL = "https://simcoe.civicweb.net/Portal/MeetingSchedule.aspx?month=" + str(month_num_adj)
    page = requests.get(URL)

    options = webdriver.ChromeOptions()
    options.add_argument('--headless')
    service = ChromeService(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    driver.get(URL)
    time.sleep(5)
    page = driver.page_source

    soup = BeautifulSoup(page, "html.parser")
    results = soup.find(id="ctl00_MainColumn")
    #pprint(results)
    event_elements = results.find_all('div', class_="calendar-meetings-link-container")

    events = []

    for event_element in event_elements:
        pprint(event_element)
        tmpev = {}
        try:
            tmpev['title'] = event_element.find("a", class_="calendar-date-meeting-link").text.strip()
            tmpev['link'] = str(event_element.find("a", class_="calendar-date-meeting-link").get("href")).strip()
        except AttributeError:
            tmpev['title'] = event_element.find("span", class_="calendar-date-meeting-link").text.strip()
            tmpev['link'] = ""

        tmpev['time'] = event_element.find("div", class_="meeting-time").text.strip()
        tmpev['location'] = event_element.find("div", class_="meeting-location").text.strip()
        
        event = {}
        title_re =  re.search(r'▪(.+) - ([0-9a-zA-Z ]+)', tmpev['title'])
        event['name'] = title_re.group(1)
        event['date'] = title_re.group(2)
        event['time'] = re.search(r'Time: (.+)', tmpev['time']).group(1)
        event['link'] = 'https://simcoe.civicweb.net' + tmpev['link']

        event['key'] = hashlib.sha256(json.dumps(event, sort_keys=True).encode('utf-8')).hexdigest()

        dt_str = event['date'] + " " + event['time']
        dt = datetime.strptime(dt_str, '%d %b %Y %I:%M %p')
        event['timestamp'] = dt
        event['group'] = "simcoe"
        event['tags'] = ["county_council"]
        event['location'] = re.search(r'Location: (.+)', tmpev['location']).group(1)

        #pprint(tmpev)
        #pprint(event)
        events.append(event)

    pprint(events)
    return events

def push_to_mongo(events):
    uri = "mongodb+srv://cluster0.znrn6ji.mongodb.net/?authSource=%24external&authMechanism=MONGODB-X509&retryWrites=true&w=majority"
    client = MongoClient(uri,
                        tls=True,
                        tlsCertificateKeyFile='/mnt/c/Users/jmaje/Downloads/X509-cert-4642243331306089962.pem')
    db = client['testDB']
    collection = db['testCol']
    for event in events:
        try:
            collection.insert_one(event)
            print("Inserting new entry.")
        except errors.DuplicateKeyError:
            print("Updating existing entry.")
            query = { "key": event.pop('key') }
            event.pop('_id')
            pprint(query)
            collection.update_one(query, { "$set": event })
    doc_count = collection.count_documents({})
    print(doc_count)


#scrape_simcoe()
#exit()

groups = {}
print("Scraping Barrie city council website...")
groups['barrie'] = scrape_barrie()
print("Scraping Simcoe County council website...")
groups['simcoe'] = scrape_simcoe()

print("Writing results to database...")
for group in groups.values():
    pprint(group)
    push_to_mongo(group)