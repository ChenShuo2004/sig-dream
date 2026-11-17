import re

p = r"C:\Users\Administrator\.cursor\projects\d-cursor-light-content-workflow-platform\agent-tools\dfe4757b-888a-4ccb-b813-9a615b520dc3.txt"
s = open(p, encoding="utf-8", errors="ignore").read()
paths = re.findall(r'"path":"([^"]+)"', s)
for path in paths:
    if "constants" in path and path.endswith((".ts", ".tsx", ".js")):
        print(path)
