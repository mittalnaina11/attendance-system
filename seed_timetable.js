require('dotenv').config();
// Replaces the demo data with the real Semester V Div A subjects and faculty from the timetable.
// Run after schema.sql and upgrade.sql:  node seed_timetable.js   (this wipes existing attendance data)
const mysql=require('mysql2/promise'),bcrypt=require('bcryptjs');
(async()=>{
 const db=await mysql.createConnection({host:process.env.DB_HOST||'localhost',port:+process.env.DB_PORT||3306,user:process.env.DB_USER||'root',password:process.env.DB_PASS||'',database:process.env.DB_NAME||'attendance_db',ssl:process.env.DB_SSL=='true'?{rejectUnauthorized:false}:undefined});
 for(const c of ['faculty_id','lab_faculty_id']){
  const [r]=await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='subjects' AND column_name=?",[c]);
  if(!r.length)await db.query(`ALTER TABLE subjects ADD COLUMN ${c} INT NULL`);
 }
 await db.query('SET FOREIGN_KEY_CHECKS=0');
 for(const t of ['records','sessions','alerts','corrections','notes','leaves','audit_log','subjects','users'])await db.query('TRUNCATE TABLE '+t);
 await db.query('SET FOREIGN_KEY_CHECKS=1');
 const h=await bcrypt.hash('password123',10);
 const U=async(n,e,r,m=null,p=null)=>(await db.query('INSERT INTO users(name,email,pass_hash,role,mentor_id,parent_of) VALUES(?,?,?,?,?,?)',[n,e,h,r,m,p]))[0].insertId;
 await U('Dr. Suresh Kurumbanshi (HOD)','hod@demo.in','hod');
 const mentor=await U('Dr. Naziya Hussain (Class In-charge)','mentor@demo.in','mentor');
 const F={};
 for(const [k,n] of [['se','Dr. Naziya Hussain (SE)'],['ai','Dr. Suresh Kurumbanshi (AI)'],['ivp','Dr. Sachin Chavan (IVP)'],['os','Prof. C. S. Pawar (OS Theory)'],['oslab','Dr. S. V. Hemanth (OS Lab)'],['mad','Dr. Atul Dusane (MAD)']])F[k]=await U(n,k+'@demo.in','faculty');
 const SB=[['SE','Software Engineering','se'],['AI','Artificial Intelligence','ai'],['IVP','Image and Video Processing','ivp'],['OS','Operating Systems','os','oslab'],['MAD','DE-I Mobile Application Development','mad']];
 const sid=[];
 for(const [c,n,f,l] of SB)sid.push((await db.query('INSERT INTO subjects(code,name,total,faculty_id,lab_faculty_id) VALUES(?,?,90,?,?)',[c,n,F[f],F[l||f]]))[0].insertId);
 const names=['Aarav Shah','Diya Patel','Kabir Mehta','Ananya Rao','Rohan Joshi','Isha Verma','Vihaan Nair','Meera Iyer','Arjun Singh','Sara Khan','Aditya Kulkarni','Riya Deshmukh','Karan Malhotra','Neha Gupta','Siddharth Jain','Pooja Pillai','Yash Agarwal','Tanvi Bhatt','Aryan Chopra','Kavya Reddy','Harsh Pandey','Simran Kaur','Omkar Patil','Sneha Menon','Devansh Thakur','Nidhi Sharma','Varun Bose','Aisha Siddiqui','Pranav Naik','Zoya Ansari'],
  pAbs=[.30,.05,.15,.05,.20,.10,.35,.08,.12,.06,.18,.04,.25,.07,.10,.14,.05,.22,.09,.03,.16,.06,.38,.08,.11,.05,.19,.07,.13,.28],ids=[];
 for(const [i,n] of names.entries())ids.push(await U(n,`student${i+1}@demo.in`,'student',mentor));
 await U('Mr. Shah (parent of Aarav)','parent@demo.in','parent',null,ids[0]);
 // every weekday from the term start (14 Sep 2026) up to today, capped at 15 weeks
 const days=[],end=new Date(Math.min(Date.now(),Date.parse('2026-12-25')));
 for(let d=new Date('2026-09-14T00:00:00Z');d<=end;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()%6)days.push(d.toISOString().slice(0,10));
 const periods=[1,2,3,4,6],bump=[1,5,9,13,17,21]; // bump: normally regular students whose last 10 days got worse (early-warning demo)
 for(const [j,s] of sid.entries())for(const [k,date] of days.entries()){
  const [r]=await db.query('INSERT INTO sessions(subject_id,date,period,marked_by) VALUES(?,?,?,?)',[s,date,periods[j],F[SB[j][2]]]);
  const recent=k>=days.length-10,dw=new Date(date+'T00:00:00Z').getUTCDay(),mult=dw==5?1.7:dw==1?1.3:1; // more absences on Fridays and Mondays
  await db.query('INSERT INTO records VALUES ?',[ids.map((id,i)=>[r.insertId,id,Math.random()<(recent&&bump.includes(i)?pAbs[i]+.4:pAbs[i])*mult?'A':'P'])]);
 }
 const L=days.length;
 await db.query('INSERT INTO leaves(student_id,type,from_date,to_date,reason) VALUES ?',[[[ids[0],'Medical',days[L-3],days[L-2],'Fever, doctor note attached'],[ids[2],'Personal',days[L-8],days[L-8],'Family function'],[ids[6],'Condonation',days[0],days[L-1],'Medical certificate for prolonged illness']]]);
 console.log('Done. Password for every account: password123');
 console.log('Logins: hod@, mentor@, se@, ai@, ivp@, os@, oslab@, mad@, student1@ to student30@, parent@  (all @demo.in)');
 process.exit();
})();
