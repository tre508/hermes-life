#!/usr/bin/env python3
"""Repair inline candidate-review validation without replacing the existing frontend."""
from pathlib import Path
from datetime import datetime
import shutil
import re

p=Path(__file__).resolve().parents[1]/'frontend/src/phase415-review.ts'
if not p.exists(): raise SystemExit(f'Missing file: {p}')
s=p.read_text()
if 'hl-review-validation' in s:
    print('Candidate review action feedback already installed.');raise SystemExit(0)

# Source contracts, both initial HL-FLOW-005 and the earlier alert workaround.
anchor=" const actions=node('div','','hl415-actions');for(const [decision,title] of [['accepted','Accept candidate'],['rejected','Reject candidate'],['revision_requested','Request revision']] as const){const b=btn(title,()=>{"
if s.count(anchor)!=1:raise SystemExit('Review action handler is not in expected form; no changes made')
validation=""" const checklistStatus=node('p',`0 of ${criteria.length} acceptance criteria confirmed`,'hl415-caption');
 checklistStatus.id='hl-review-checklist-status';root.append(checklistStatus);
 marks.forEach(check=>check.addEventListener('change',()=>{const count=marks.filter(x=>x.checked).length;checklistStatus.textContent=`${count} of ${criteria.length} acceptance criteria confirmed`;}));
 const validation=node('p','','hl415-error');validation.id='hl-review-validation';validation.setAttribute('role','alert');root.append(validation);
 const reportError=(message:string,focus?:HTMLElement)=>{validation.textContent=message;validation.scrollIntoView({behavior:'smooth',block:'nearest'});focus?.focus({preventScroll:true})};
"""
s=s.replace(anchor,validation+anchor,1)

# Replace the whole first validation branch (known variants) without modifying the actual gate.
pattern=r"if\(decision==='accepted'&&\(s\(run\.state\)!=='candidate_passed'\|\|!criteria\.length\|\|!marks\.every\(x=>x\.checked\)\)\)\{.*?;return\}"
replacement="if(decision==='accepted'&&(s(run.state)!=='candidate_passed'||!criteria.length||!marks.every(x=>x.checked))){reportError('Acceptance blocked: independently passing candidate tests and confirmation of all '+criteria.length+' criteria are required.',marks.find(x=>!x.checked));return}"
s,num=re.subn(pattern,replacement,s,count=1,flags=re.S)
if num!=1:raise SystemExit('Accept validation did not match; no changes made')
pattern=r"if\(decision!=='accepted'&&!feedback\.value\.trim\(\)\)\{.*?;return\}"
replacement="if(decision!=='accepted'&&!feedback.value.trim()){reportError('Enter a reason before rejecting or requesting revision.',feedback);return}"
s,num=re.subn(pattern,replacement,s,count=1,flags=re.S)
if num!=1:raise SystemExit('Reject/revise validation did not match; no changes made')

# Clear validation when starting an actual request; display submission errors in place, not at end of section.
anchor="  requestBusy=true;b.disabled=true;void api(`/implementations/${encodeURIComponent(s(run.id))}/review`,'POST',{"
if s.count(anchor)!=1:raise SystemExit('Submission handler did not match; no changes made')
s=s.replace(anchor,"  validation.textContent='Submitting review decision…';requestBusy=true;b.disabled=true;void api(`/implementations/${encodeURIComponent(s(run.id))}/review`,'POST',{",1)
anchor=".catch(e=>{reviewError=s(e);root.append(node('p',reviewError,'hl415-error'))}).finally"
if s.count(anchor)!=1:raise SystemExit('Submission error handler did not match; no changes made')
s=s.replace(anchor,".catch(e=>{reviewError=s(e);reportError('Review request failed: '+reviewError)}).finally",1)

backup=p.with_name(p.name+'.pre-review-actions-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
shutil.copy2(p,backup)
p.write_text(s)
print('Patched',p)
print('Backup',backup)
