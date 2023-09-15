import requests
from bs4 import BeautifulSoup
from pprint import pprint
import re

URL = "https://barrie.legistar.com/Calendar.aspx"
page = requests.get(URL)

soup = BeautifulSoup(page.content, "html.parser")

results = soup.find(id="ctl00_ContentPlaceHolder1_gridCalendar_ctl00")

#print(results.prettify())

event_elements = results.find_all(True, {'class': ['rgRow', 'rgAltRow']})

#pprint(event_elements)
event = {}
for event_element in event_elements:
    event['name'] = event_element.find("a", id=re.compile('.*hypBody')).text
    event['date'] = event_element.find("td", class_="rgSorted").text
    event['time'] = event_element.find("span", id=re.compile('.*lblTime')).text
    event['link'] = "https://barrie.legistar.com/" + str(event_element.find("a", id=re.compile('.*hypMeetingDetail')).get("href"))

    pprint(event)

#pprint(event)