import requests
import json

url = "https://2y9rv4j811.execute-api.eu-central-1.amazonaws.com/prod/api/query"
api_key = "DcKzuIsD1I5Xjg84ocriZ3vIUIbezC5K2CLtstUO"
headers = {"x-api-key": api_key, "Content-Type": "application/json"}

# Test stats
payload = {"action": "stats"}
response = requests.post(url, headers=headers, json=payload)
print("STATS:")
print(json.dumps(response.json(), indent=2, ensure_ascii=False))

# Let's count how many distinct names there are vs total rows
payload2 = {"action": "list", "limit": 10000}
response2 = requests.post(url, headers=headers, json=payload2)
data2 = response2.json()
meds = data2.get("medicines", [])
names = [m.get("name") for m in meds]
unique_names = set(names)
print(f"Total rows fetched: {len(names)}")
print(f"Unique names: {len(unique_names)}")

