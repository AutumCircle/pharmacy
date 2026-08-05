import requests
import json

url = "https://2y9rv4j811.execute-api.eu-central-1.amazonaws.com/prod/api/query"
api_key = "DcKzuIsD1I5Xjg84ocriZ3vIUIbezC5K2CLtstUO"
headers = {"x-api-key": api_key, "Content-Type": "application/json"}

print("Wiping database...")
payload = {"action": "wipe_db"}
response = requests.post(url, headers=headers, json=payload)

if response.status_code == 200:
    print("Success:", response.json())
else:
    print("Error:", response.status_code, response.text)
