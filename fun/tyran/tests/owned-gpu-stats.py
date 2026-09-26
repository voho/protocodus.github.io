"""Read driver-accumulated GPU time only for explicitly supplied benchmark PIDs."""
import json
import plistlib
import re
import subprocess
import sys
import time

pids=set(map(int,sys.argv[1:]))
started=time.monotonic()
entries=plistlib.loads(subprocess.check_output(['ioreg','-a','-r','-c','AGXDeviceUserClient']))
clients=[]
for entry in entries:
    match=re.search(r'pid\s+(\d+)',entry.get('IOUserClientCreator',''))
    if not match or int(match[1]) not in pids:
        continue
    usage=entry.get('AppUsage',[])
    clients.append({'pid':int(match[1]), 'registryId':entry['IORegistryEntryID'],
                    'usage':[{'api':v.get('API'), 'gpuTime':v.get('accumulatedGPUTime',0),
                              'lastSubmittedTime':v.get('lastSubmittedTime',0)} for v in usage],
                    'gpuTime':sum(v.get('accumulatedGPUTime',0) for v in usage)})
print(json.dumps({'at':time.time(),'readDurationMs':(time.monotonic()-started)*1000,
                  'clients':clients,'gpuTime':sum(c['gpuTime'] for c in clients)}))
