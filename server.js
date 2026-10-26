require('dotenv').config();
const FAIL={};
const express=require('express'),mysql=require('mysql2/promise'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken');
const app=express(),SECRET=process.env.JWT_SECRET||'change-this-secret';
app.set('trust proxy',1);app.use(express.json());app.use(express.static('public'));
const db=mysql.createPool({host:process.env.DB_HOST||'localhost',port:+process.env.DB_PORT||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASS||'',database:process.env.DB_NAME||'attendance_db',dateStrings:true,ssl:process.env.DB_SSL=='true'?{rejectUnauthorized:false}:undefined});

// ---- helpers: auth (JWT + role check), error wrapper, audit log, notification stub
const auth=(...roles)=>(q,s,n)=>{try{q.u=jwt.verify((q.headers.authorization||'').split(' ')[1],SECRET)}catch{return s.sendStatus(401)}
 if(roles.length&&!roles.includes(q.u.role))return s.sendStatus(403);n()};
const route=(m,p,roles,f)=>app[m]('/api'+p,auth(...roles),(q,s)=>f(q,s).catch(e=>s.status(500).json({error:e.message})));
const log=(u,a)=>db.query('INSERT INTO audit_log(user_id,action) VALUES(?,?)',[u,a]);
const notify=(to,msg)=>console.log('[NOTIFY]',to,msg); // replace with nodemailer / Twilio
const th=async()=>+(await db.query("SELECT v FROM settings WHERE k='threshold'"))[0][0].v;
const MSG={en:(n,s,p,t,k)=>`${n}: attendance in ${s} is ${p}% (below ${t}%). Attend ${k} more classes to recover.`,
 hi:(n,s,p,t,k)=>`${n}: ${s} में उपस्थिति ${p}% है (${t}% से कम)। ${k} और कक्षाएँ लें।`,
 mr:(n,s,p,t,k)=>`${n}: ${s} मध्ये उपस्थिती ${p}% आहे (${t}% पेक्षा कमी). ${k} आणखी तास उपस्थित रहा.`};
const need=(p,c,t)=>Math.max(0,Math.ceil((t/100*c-p)/(1-t/100))),skip=(p,c,t)=>Math.max(0,Math.floor(p/(t/100)-c));
const mine=u=>db.query("SELECT id,name FROM users WHERE role='student'"+(u.role=='mentor'?' AND mentor_id=?':''),u.role=='mentor'?[u.id]:[]).then(r=>r[0]);

// ---- calculation engine: present = P or L, or A covered by an approved (non-condonation) leave
async function stats(where='',args=[],from='1970-01-01',to='9999-12-31'){
 const [rows]=await db.query(`SELECT r.student_id sid,s.subject_id sub,COUNT(*) c,
  SUM(r.status<>'A' OR EXISTS(SELECT 1 FROM leaves l WHERE l.student_id=r.student_id AND l.status='Approved' AND l.type<>'Condonation' AND s.date BETWEEN l.from_date AND l.to_date)) p
  FROM records r JOIN sessions s ON s.id=r.session_id WHERE s.date BETWEEN ? AND ? ${where} GROUP BY r.student_id,s.subject_id`,[from,to,...args]);
 return rows.map(x=>({...x,c:+x.c,p:+x.p,pc:Math.round(x.p/x.c*1000)/10}));
}

// ---- auth
app.post('/api/login',(q,s)=>(async()=>{
 const key=String(q.body.email).toLowerCase(),f=FAIL[key]||{n:0,t:0};
 if(f.n>=5&&Date.now()-f.t<9e5)return s.status(429).json({error:'Too many attempts. Try again in 15 minutes.'});
 const [[u]]=await db.query('SELECT * FROM users WHERE email=?',[q.body.email]);
 if(!u||!await bcrypt.compare(q.body.password||'',u.pass_hash)){FAIL[key]={n:(Date.now()-f.t<9e5?f.n:0)+1,t:Date.now()};return s.status(401).json({error:'Wrong email or password'})}
 delete FAIL[key];
 const user={id:u.id,name:u.name,role:u.role,parent_of:u.parent_of};
 s.json({token:jwt.sign(user,SECRET,{expiresIn:'8h'}),user});
})().catch(e=>s.status(500).json({error:e.message})));

route('get','/subjects',[],async(q,s)=>s.json((await db.query(q.u.role=='faculty'?'SELECT * FROM subjects WHERE faculty_id=? OR lab_faculty_id=?':'SELECT * FROM subjects WHERE ?=?',q.u.role=='faculty'?[q.u.id,q.u.id]:[1,1]))[0]));
route('get','/students',['faculty','mentor','hod'],async(q,s)=>s.json(await mine(q.u)));

// ---- student / parent dashboard: per-subject %, skip/need advice, projection, eligibility
route('get','/summary',['student','parent'],async(q,s)=>{
 const id=q.u.role=='parent'?q.u.parent_of:q.u.id,t=await th();
 const [subs]=await db.query('SELECT * FROM subjects'),st=await stats('AND r.student_id=?',[id]);
 const out=subs.map(b=>{const x=st.find(y=>y.sub==b.id)||{p:0,c:0,pc:100};
  return{code:b.code,total:b.total,...x,skip:skip(x.p,x.c,t),need:need(x.p,x.c,t),projected:Math.round((x.p+b.total-x.c)/b.total*100)}});
 const [[cd]]=await db.query("SELECT COUNT(*) n FROM leaves WHERE student_id=? AND type='Condonation' AND status='Approved'",[id]);
 s.json({threshold:t,subjects:out,eligibility:out.every(x=>x.pc>=t)?'Eligible':cd.n?'Condoned':'Not Eligible'});
});

// ---- faculty marks attendance: saves, recalculates, raises alerts below threshold
route('post','/attendance',['faculty'],async(q,s)=>{
 const {subject_id,date,period=1,marks}=q.body,t=await th();
 const [own]=await db.query('SELECT 1 FROM subjects WHERE id=? AND (faculty_id=? OR lab_faculty_id=?)',[subject_id,q.u.id,q.u.id]);
 if(!own.length)return s.status(403).json({error:'You are not assigned to this subject'});
 const c=await db.getConnection();
 try{await c.beginTransaction();
  await c.query('INSERT INTO sessions(subject_id,date,period,marked_by) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE marked_by=VALUES(marked_by)',[subject_id,date,period,q.u.id]);
  const [[ses]]=await c.query('SELECT id FROM sessions WHERE subject_id=? AND date=? AND period=?',[subject_id,date,period]);
  await c.query('DELETE FROM records WHERE session_id=?',[ses.id]);
  const ids=Object.keys(marks);if(ids.length)await c.query('INSERT INTO records VALUES ?',[ids.map(i=>[ses.id,i,marks[i]])]);
  await c.commit();
 }catch(e){await c.rollback();throw e}finally{c.release()}
 const [[sub]]=await db.query('SELECT code FROM subjects WHERE id=?',[subject_id]);
 let n=0;
 for(const x of (await stats('AND s.subject_id=?',[subject_id])).filter(y=>y.pc<t&&marks[y.sid])){
  const [[u]]=await db.query('SELECT name,lang FROM users WHERE id=?',[x.sid]);
  const m=MSG[u.lang](u.name,sub.code,x.pc,t,need(x.p,x.c,t));
  await db.query('INSERT INTO alerts(student_id,subject_id,percent,message,channel) VALUES(?,?,?,?,?)',[x.sid,subject_id,x.pc,m,'Email + SMS to student, parent, mentor'+(x.pc<70?' + HOD (escalated)':'')]);
  mailAlert(x.sid,m);n++;
 }
 await log(q.u.id,`Marked ${sub.code} for ${date} period ${period}`);
 s.json({saved:true,alerts:n});
});

// ---- leave and condonation workflow (mentor decides leave, HOD decides condonation)
route('get','/leaves',['student','mentor','hod'],async(q,s)=>{
 const u=q.u;let w,a=[];
 if(u.role=='student'){w='l.student_id=?';a=[u.id]}else if(u.role=='mentor'){w="x.mentor_id=? AND l.type<>'Condonation'";a=[u.id]}else w="l.type='Condonation'";
 s.json((await db.query(`SELECT l.*,x.name FROM leaves l JOIN users x ON x.id=l.student_id WHERE ${w} ORDER BY l.id DESC`,a))[0]);
});
route('post','/leaves',['student'],async(q,s)=>{
 const {type,from_date,to_date,reason}=q.body;
 if(!type||!from_date||!to_date||to_date<from_date||!reason)return s.status(400).json({error:'Enter a valid date range and reason'});
 await db.query('INSERT INTO leaves(student_id,type,from_date,to_date,reason) VALUES(?,?,?,?,?)',[q.u.id,type,from_date,to_date,reason]);
 await log(q.u.id,'Submitted '+type+' request');s.json({ok:true});
});
route('post','/leaves/:id/decision',['mentor','hod'],async(q,s)=>{
 const {approve,note=''}=q.body;
 if(!approve&&!note.trim())return s.status(400).json({error:'A reason is required to reject'});
 const [[l]]=await db.query('SELECT l.type,x.mentor_id FROM leaves l JOIN users x ON x.id=l.student_id WHERE l.id=?',[q.params.id]);
 if(!l||(q.u.role=='hod')!=(l.type=='Condonation')||(q.u.role=='mentor'&&l.mentor_id!=q.u.id))return s.sendStatus(403);
 await db.query('UPDATE leaves SET status=?,decision_note=?,decided_by=? WHERE id=?',[approve?'Approved':'Rejected',note,q.u.id,q.params.id]);
 await log(q.u.id,(approve?'Approved':'Rejected')+' request #'+q.params.id);s.json({ok:true});
});

route('get','/alerts',['student','parent','mentor','hod'],async(q,s)=>{
 const u=q.u,w=u.role=='student'?['a.student_id=?',u.id]:u.role=='parent'?['a.student_id=?',u.parent_of]:u.role=='mentor'?['x.mentor_id=?',u.id]:['1=?',1];
 s.json((await db.query(`SELECT a.*,x.name,b.code FROM alerts a JOIN users x ON x.id=a.student_id JOIN subjects b ON b.id=a.subject_id WHERE ${w[0]} ORDER BY a.id DESC LIMIT 50`,[w[1]]))[0]);
});

// ---- reports: daily / weekly / monthly / semester / custom, JSON or CSV
route('get','/report',['faculty','mentor','hod'],async(q,s)=>{
 const {type='semester',subject,from,to,format}=q.query,t=await th(),D={daily:0,weekly:6,monthly:29};
 let f='1970-01-01',e='9999-12-31';
 if(type in D){f=new Date(Date.now()-D[type]*864e5).toISOString().slice(0,10);e=new Date().toISOString().slice(0,10)}else if(type=='custom'){f=from;e=to}
 const st=await stats(subject?'AND s.subject_id=?':'',subject?[subject]:[],f,e);
 const rows=(await mine(q.u)).map(x=>{const r=st.filter(y=>y.sid==x.id),p=r.reduce((a,y)=>a+y.p,0),c=r.reduce((a,y)=>a+y.c,0),pc=c?Math.round(p/c*1000)/10:100;
  return{name:x.name,present:p,held:c,percent:pc,status:pc>=t?'Eligible':'Not Eligible',parent_notice:type=='monthly'&&pc<85?'Sent':''}});
 if(format=='csv')s.type('text/csv').attachment('report.csv').send('Name,Present,Held,Percent,Status\n'+rows.map(r=>[r.name,r.present,r.held,r.percent,r.status].join(',')).join('\n'));
 else s.json(rows);
});

// ---- HOD: configurable threshold and audit log
route('get','/threshold',['hod'],async(q,s)=>s.json({threshold:await th()}));
route('put','/threshold',['hod'],async(q,s)=>{
 const v=+q.body.threshold;if(!(v>=50&&v<=100))return s.status(400).json({error:'Enter a threshold between 50 and 100'});
 await db.query("UPDATE settings SET v=? WHERE k='threshold'",[v]);await log(q.u.id,'Threshold set to '+v+'%');s.json({ok:true});
});
route('get','/audit',['hod'],async(q,s)=>s.json((await db.query('SELECT a.created_at,a.action,x.name FROM audit_log a LEFT JOIN users x ON x.id=a.user_id ORDER BY a.id DESC LIMIT 50'))[0]));

// ---- v2: history for calendar and trend chart
route('get','/history',['student','parent'],async(q,s)=>{
 const id=q.u.role=='parent'?q.u.parent_of:q.u.id;
 s.json((await db.query(`SELECT s.id sid,s.date,b.code,r.status,
  EXISTS(SELECT 1 FROM leaves l WHERE l.student_id=r.student_id AND l.status='Approved' AND l.type<>'Condonation' AND s.date BETWEEN l.from_date AND l.to_date) ex
  FROM records r JOIN sessions s ON s.id=r.session_id JOIN subjects b ON b.id=s.subject_id
  WHERE r.student_id=? AND s.date>=DATE_SUB(CURDATE(),INTERVAL 59 DAY) ORDER BY s.date`,[id]))[0]);
});

// ---- v2: attendance correction requests (student asks, faculty decides)
route('get','/corrections',['student','faculty'],async(q,s)=>{
 const st=q.u.role=='student';
 s.json((await db.query(`SELECT c.*,x.name,s.date,b.code FROM corrections c JOIN users x ON x.id=c.student_id JOIN sessions s ON s.id=c.session_id
  JOIN subjects b ON b.id=s.subject_id WHERE ${st?'c.student_id=?':'(b.faculty_id=? OR b.lab_faculty_id=?)'} ORDER BY c.id DESC`,st?[q.u.id]:[q.u.id,q.u.id]))[0]);
});
route('post','/corrections',['student'],async(q,s)=>{
 const {session_id,claimed='P',reason}=q.body;
 const [r]=await db.query("SELECT 1 FROM records WHERE session_id=? AND student_id=? AND status='A'",[session_id,q.u.id]);
 const [d]=await db.query("SELECT 1 FROM corrections WHERE session_id=? AND student_id=? AND status='Pending'",[session_id,q.u.id]);
 if(!r.length||!reason)return s.status(400).json({error:'Choose an absence and give a reason'});
 if(d.length)return s.status(400).json({error:'A request for this class is already pending'});
 await db.query('INSERT INTO corrections(student_id,session_id,claimed,reason) VALUES(?,?,?,?)',[q.u.id,session_id,claimed=='L'?'L':'P',reason]);
 await log(q.u.id,'Requested attendance correction');s.json({ok:true});
});
route('post','/corrections/:id/decision',['faculty'],async(q,s)=>{
 const {approve,note=''}=q.body;
 if(!approve&&!note.trim())return s.status(400).json({error:'A reason is required to reject'});
 const [[c]]=await db.query("SELECT * FROM corrections WHERE id=? AND status='Pending'",[q.params.id]);
 if(!c)return s.sendStatus(404);
 const [own]=await db.query('SELECT 1 FROM sessions s JOIN subjects b ON b.id=s.subject_id WHERE s.id=? AND (b.faculty_id=? OR b.lab_faculty_id=?)',[c.session_id,q.u.id,q.u.id]);
 if(!own.length)return s.sendStatus(403);
 await db.query('UPDATE corrections SET status=?,decision_note=? WHERE id=?',[approve?'Approved':'Rejected',note,c.id]);
 if(approve)await db.query('UPDATE records SET status=? WHERE session_id=? AND student_id=?',[c.claimed,c.session_id,c.student_id]);
 await log(q.u.id,(approve?'Approved':'Rejected')+' correction #'+c.id);s.json({ok:true});
});

// ---- v2: early-warning risk table (trend over last 14 days vs overall) with escalation level
route('get','/risk',['mentor','hod'],async(q,s)=>{
 const t=await th(),stu=await mine(q.u),all=await stats(),rec=await stats('',[],new Date(Date.now()-14*864e5).toISOString().slice(0,10));
 const [subs]=await db.query('SELECT id,code FROM subjects');
 const sum=(a,id)=>{const r=a.filter(y=>y.sid==id),p=r.reduce((z,y)=>z+y.p,0),c=r.reduce((z,y)=>z+y.c,0);return c?Math.round(p/c*1000)/10:100};
 const out=[];
 for(const x of stu){
  const r=all.filter(y=>y.sid==x.id).sort((a,b)=>a.pc-b.pc),lo=r[0]||{pc:100},o=sum(all,x.id),rc=sum(rec,x.id);
  const [nr]=await db.query('SELECT id,note,follow_up FROM notes WHERE student_id=? ORDER BY id DESC LIMIT 1',[x.id]),n=nr[0]||{};
  out.push({id:x.id,name:x.name,t,overall:o,low:lo.pc,low_code:(subs.find(b=>b.id==lo.sub)||{}).code,trending:rc<o-5&&rc<t+5,
   esc:lo.pc<60?'HOD + parent meeting':lo.pc<70?'HOD':lo.pc<t?'Mentor':'',last_note:n.note,follow_up:n.follow_up,note_id:n.id});
 }
 s.json(out.sort((a,b)=>a.low-b.low));
});

// ---- v2: mentor meeting notes with follow-up status
route('post','/notes',['mentor'],async(q,s)=>{
 const {student_id,note}=q.body,[[x]]=await db.query('SELECT id FROM users WHERE id=? AND mentor_id=?',[student_id,q.u.id]);
 if(!x||!note||!note.trim())return s.status(400).json({error:'Write a note for one of your mentees'});
 await db.query('INSERT INTO notes(student_id,mentor_id,note) VALUES(?,?,?)',[student_id,q.u.id,note.trim()]);
 await log(q.u.id,'Added mentor note');s.json({ok:true});
});
route('post','/notes/:id/done',['mentor'],async(q,s)=>{
 await db.query("UPDATE notes SET follow_up='Done' WHERE id=? AND mentor_id=?",[q.params.id,q.u.id]);s.json({ok:true});
});

// ---- v2: bulk student import (HOD). Lines: name,email,mentor_id(optional)
route('post','/import',['hod'],async(q,s)=>{
 const h=await bcrypt.hash('password123',10);let n=0;
 for(const line of (q.body.csv||'').split('\n')){
  const [name,email,mentor]=line.split(',').map(x=>x&&x.trim());
  if(!name||!email||!email.includes('@')||name.toLowerCase()=='name')continue;
  const [r]=await db.query("INSERT IGNORE INTO users(name,email,pass_hash,role,mentor_id) VALUES(?,?,?,'student',?)",[name,email,h,mentor||null]);n+=r.affectedRows;
 }
 await log(q.u.id,'Imported '+n+' students');s.json({imported:n});
});

// ---- v3: email alerts (nodemailer, optional), QR check-in, password change
const nodemailer=require('nodemailer'),QRCode=require('qrcode'),crypto=require('crypto');
const mailer=process.env.SMTP_HOST?nodemailer.createTransport({host:process.env.SMTP_HOST,port:+process.env.SMTP_PORT||587,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}):null;
async function mailAlert(sid,text){
 const [r]=await db.query('SELECT email FROM users WHERE id=? OR parent_of=? OR id=(SELECT mentor_id FROM users WHERE id=?)',[sid,sid,sid]),to=r.map(x=>x.email).join(',');
 if(!mailer)return console.log('[EMAIL not configured]',to,text);
 await mailer.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to,subject:'Attendance alert',text}).catch(e=>console.log('Email failed:',e.message));
}
route('post','/qr/start',['faculty'],async(q,s)=>{
 const {subject_id,period=1}=q.body,date=new Date().toISOString().slice(0,10);
 const [own]=await db.query('SELECT 1 FROM subjects WHERE id=? AND (faculty_id=? OR lab_faculty_id=?)',[subject_id,q.u.id,q.u.id]);
 if(!own.length)return s.status(403).json({error:'You are not assigned to this subject'});
 await db.query('INSERT INTO sessions(subject_id,date,period,marked_by) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE marked_by=VALUES(marked_by)',[subject_id,date,period,q.u.id]);
 const [[ses]]=await db.query('SELECT id FROM sessions WHERE subject_id=? AND date=? AND period=?',[subject_id,date,period]);
 await db.query("INSERT IGNORE INTO records(session_id,student_id,status) SELECT ?,id,'A' FROM users WHERE role='student'",[ses.id]);
 const code=crypto.randomBytes(3).toString('hex').toUpperCase(),exp=Date.now()+12e4;
 await db.query('INSERT INTO checkins(code,session_id,expires_at) VALUES(?,?,?)',[code,ses.id,new Date(exp)]);
 await log(q.u.id,'Started QR check-in '+code);
 s.json({code,exp,img:await QRCode.toDataURL(`${q.protocol}://${q.headers.host}/?c=${code}`,{width:300})});
});
route('get','/qr/status/:code',['faculty'],async(q,s)=>{
 const [[c]]=await db.query('SELECT session_id FROM checkins WHERE code=?',[q.params.code]);
 if(!c)return s.sendStatus(404);
 const [[r]]=await db.query("SELECT SUM(status<>'A') present,COUNT(*) total FROM records WHERE session_id=?",[c.session_id]);
 s.json({present:+r.present,total:r.total});
});
route('post','/checkin',['student'],async(q,s)=>{
 const [[c]]=await db.query('SELECT c.session_id,s.period,b.code subject FROM checkins c JOIN sessions s ON s.id=c.session_id JOIN subjects b ON b.id=s.subject_id WHERE c.code=? AND c.expires_at>NOW()',[(q.body.code||'').toUpperCase()]);
 if(!c)return s.status(400).json({error:'Code is invalid or expired'});
 await db.query("UPDATE records SET status='P' WHERE session_id=? AND student_id=? AND status='A'",[c.session_id,q.u.id]);
 await log(q.u.id,'QR check-in '+c.subject);s.json({subject:c.subject,period:c.period});
});
route('post','/password',[],async(q,s)=>{
 const {old:o,new:nw}=q.body,[[u]]=await db.query('SELECT pass_hash FROM users WHERE id=?',[q.u.id]);
 if(!await bcrypt.compare(o||'',u.pass_hash))return s.status(400).json({error:'Current password is wrong'});
 if(!nw||nw.length<8)return s.status(400).json({error:'New password must be at least 8 characters'});
 await db.query('UPDATE users SET pass_hash=? WHERE id=?',[await bcrypt.hash(nw,10),q.u.id]);
 await log(q.u.id,'Changed password');s.json({ok:true});
});

// ---- v4: absence pattern insights (weekday x time slot) for faculty, mentor and HOD
route('get','/insights',['faculty','mentor','hod'],async(q,s)=>{
 const f=q.u.role=='faculty';
 const [r]=await db.query(`SELECT WEEKDAY(s.date) dow,s.period,b.code,SUM(r.status='A') absent,COUNT(*) total
  FROM records r JOIN sessions s ON s.id=r.session_id JOIN subjects b ON b.id=s.subject_id
  WHERE ${f?'(b.faculty_id=? OR b.lab_faculty_id=?)':'?=?'} GROUP BY dow,s.period,b.code`,f?[q.u.id,q.u.id]:[1,1]);
 s.json(r.map(x=>({...x,absent:+x.absent,total:+x.total})));
});

app.listen(process.env.PORT||3000,()=>console.log('Running on http://localhost:'+(process.env.PORT||3000)));
