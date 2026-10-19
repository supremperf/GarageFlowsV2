"""Bounded manual decisions; no rule suppression or inferred full functional closure."""
from pathlib import Path
import json,collections,datetime
b=Path(__file__).resolve().parent
rows={r['id']:r for r in map(json.loads,(b/'sast-findings-final.jsonl').read_text().splitlines())};triage=[]
for old in map(json.loads,(b.parent/'sast-triage.jsonl').read_text().splitlines()):
 r=dict(old);r['id']=r.pop('findingId');r['currentScope']='Unchanged fixed-length guards; original bounded assessment retained.';r['proof']=['../'+p for p in r.pop('evidence')];triage.append(r)
for ids,classification,status,reason in [
 (['0001','0002','0003','0004','0005','0006'],'FIXED_TEST_DOM_NOT_UNTRUSTED_XSS','VALIDÉ','Both innerHTML sites receive only closed-over SAMPLE/INSP_INPUT constants from the same fully read test module. Theme values are local fixed cases. No external/customer data reaches these interpolations. Not a rendering pass.'),
 (['0181','0182'],'NO_NON_NONE_RETURN_FROM_CONSTRUCTOR','VALIDÉ','The two __init__ bodies initialize members/build UI, no explicit non-None return. Lambda is assigned as a callback, not returned from __init__. Scoped to these constructors, not whole UI certification.'),
 (['0257','0258'],'INTENTIONAL_TEST_WORKER_DELAY','VALIDÉ','Sleeps deliberately model a delayed test worker while closing Tk windows, not production timing or authentication delay. Real Tk execution remains separate.'),
 (['0079'],'REQUIRES_UPDATER_CALLER_POLICY_REVIEW','PARTIELLEMENT VALIDÉ','spawn uses installer path and empty argv without shell after SHA validation. Full URL/signature/caller authorization/native launch chain remains incompletely reviewed; no exploit/false-positive conclusion.'),
 (['0172'],'STATIC_SHELL_COMMAND_AUDIT_PARTIAL','PARTIELLEMENT VALIDÉ','Helper/static callsites inspected, shell is for Windows portability. Every command boundary and downstream environment not newly closed; no blanket shell-rule exemption.'),
 (['0865'],'OWNED_PRIVATE_TEMPORARY_CLEANUP','VALIDÉ','Only const directory returned by mkdtempSync under a fixed prefix is recursively removed. No external filename assigned. Unit tests cover owned cleanup and error paths; controlled CI filesystem assumption, not hostile same-UID guarantee.'),
]:
 for suffix in ids:
  rid='SAST-20261014-'+suffix;r=rows[rid]
  triage.append({'id':rid,'ruleId':r['ruleId'],'path':r['path'],'sourceSha256':r['sourceSha256'],'status':status,'classification':classification,'reason':reason,'proof':['review-ledger.jsonl','sast-findings-final.jsonl'],'limits':'Source-level finding review; no rule disabled or full functional success inferred.'})
assert len({r['id'] for r in triage})==len(triage)==17
for r in triage:assert r['sourceSha256']==rows[r['id']]['sourceSha256']
(b/'sast-triage-current.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in triage))
(b/'sast-ledger-corrections.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'superseded':['sast-findings.jsonl','sast-summary.json','draft-line-key-*','draft-span-*'],'authoritative':['sast-findings-final.jsonl','sast-summary-final.json','sast-location-groups-final.json'],'corrections':['Normalize pinned absolute rule-directory prefix for historical ID matching.','Use column and line boundaries, retain all duplicate occurrence IDs.','Pre-scan manifest hashes and current hashes distinct.','First exact-span generator failed in grouping unpacking; failed proof kept; final generator reconciles all865 IDs.'],'rawSignals':865,'uniqueExactRuleRanges':845,'duplicateOccurrencesRetained':20,'historicalIdsRetained':864,'triageRecords':17,'pendingRawSignals':848,'limits':'Draft files retained, not used to claim closure.'},indent=2))
print(json.dumps({'triaged':17,'statuses':dict(collections.Counter(r['status'] for r in triage)),'pending':848}))
