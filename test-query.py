import os
import requests
import json

url = "https://2y9rv4j811.execute-api.eu-central-1.amazonaws.com/prod/api/query"
api_key = "DcKzuIsD1I5Xjg84ocriZ3vIUIbezC5K2CLtstUO"
headers = {"x-api-key": api_key, "Content-Type": "application/json"}

# Test search
payload = {"action": "search", "name": "а", "limit": 20}
response = requests.post(url, headers=headers, json=payload)
data = response.json()
print("SEARCH RESULTS:")
for m in data.get("matches", [])[:20]:
    print(f" - {m.get('name')} | {m.get('country')} | {m.get('vendor')} | {m.get('price')} | in_stock: {m.get('in_stock')}")

print("\n----------------\n")
# Test list with pagination
payload2 = {"action": "list", "limit": 20, "offset": 20}
response2 = requests.post(url, headers=headers, json=payload2)
data2 = response2.json()
print("PAGE 2 RESULTS:")
for m in data2.get("medicines", [])[:20]:
    print(f" - {m.get('name')} | {m.get('country')} | {m.get('vendor')} | {m.get('price')} | in_stock: {m.get('in_stock')}")
