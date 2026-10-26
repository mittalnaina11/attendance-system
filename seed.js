// Creates demo users and 24 sessions per subject. Run once after schema.sql: node seed.js
const mysql=require('mysql2/promise'),bcrypt=require('bcryptjs');
(async()=>{
 const db=await mysql.createConnection({host:process.env.DB_HOST||'localhost',user:process.env.DB_USER||'root',password:process.env.DB_PASS||'',database:'attendance_db'});
 const h=await bcrypt.hash('password123',10);
 const U=async(n,e,r,m=null,p=null)=>(await db.query('INSERT INTO users(name,email,pass_hash,role,mentor_id,parent_of) VALUES(?,?,?,?,?,?)',[n,e,h,r,m,p]))[0].insertId;
 await U('Prof. Rao','hod@demo.in','hod');
 const mentor=await U('Dr. Hussain','mentor@demo.in','mentor'),fac=await U('Prof. Kulkarni','faculty@demo.in','faculty');
 const names=['Aarav Shah','Diya Patel','Kabir Mehta','Ananya Rao','Rohan Joshi'],ids=[];
 for(const [i,n] of names.entries())ids.push(await U(n,`student${i+1}@demo.in`,'student',mentor));
 await U('Mr. Shah','parent@demo.in','parent',null,ids[0]);
 const [subs]=await db.query('SELECT id FROM subjects'),pAbs=[.3,.05,.15,.05,.2];
 for(const s of subs)for(let d=1;d<=24;d++){
  const date=new Date(Date.now()-(30-d)*864e5).toISOString().slice(0,10);
  const [r]=await db.query('INSERT INTO sessions(subject_id,date,period,marked_by) VALUES(?,?,1,?)',[s.id,date,fac]);
  await db.query('INSERT INTO records VALUES ?',[ids.map((id,i)=>[r.insertId,id,Math.random()<pAbs[i]?'A':'P'])]);
 }
 console.log('Seeded. All demo passwords: password123');process.exit();
})();
