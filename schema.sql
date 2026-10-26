CREATE DATABASE IF NOT EXISTS attendance_db; USE attendance_db;
CREATE TABLE users(id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(80),email VARCHAR(100) UNIQUE,pass_hash VARCHAR(100),
 role ENUM('student','faculty','mentor','hod','parent'),mentor_id INT NULL,parent_of INT NULL,lang ENUM('en','hi','mr') DEFAULT 'en',
 FOREIGN KEY(mentor_id) REFERENCES users(id),FOREIGN KEY(parent_of) REFERENCES users(id));
CREATE TABLE subjects(id INT AUTO_INCREMENT PRIMARY KEY,code VARCHAR(10),name VARCHAR(60),total INT DEFAULT 90,faculty_id INT NULL,lab_faculty_id INT NULL);
CREATE TABLE sessions(id INT AUTO_INCREMENT PRIMARY KEY,subject_id INT,date DATE,period TINYINT DEFAULT 1,marked_by INT,
 UNIQUE(subject_id,date,period),FOREIGN KEY(subject_id) REFERENCES subjects(id));
CREATE TABLE records(session_id INT,student_id INT,status ENUM('P','A','L'),PRIMARY KEY(session_id,student_id),
 FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,FOREIGN KEY(student_id) REFERENCES users(id));
CREATE TABLE leaves(id INT AUTO_INCREMENT PRIMARY KEY,student_id INT,type ENUM('Medical','Personal','Emergency','Condonation'),
 from_date DATE,to_date DATE,reason VARCHAR(255),status ENUM('Pending','Approved','Rejected') DEFAULT 'Pending',
 decision_note VARCHAR(255) DEFAULT '',decided_by INT NULL,FOREIGN KEY(student_id) REFERENCES users(id));
CREATE TABLE alerts(id INT AUTO_INCREMENT PRIMARY KEY,student_id INT,subject_id INT,percent DECIMAL(5,1),message VARCHAR(400),
 channel VARCHAR(120),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE audit_log(id INT AUTO_INCREMENT PRIMARY KEY,user_id INT,action VARCHAR(200),created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE settings(k VARCHAR(30) PRIMARY KEY,v VARCHAR(30));
INSERT INTO settings VALUES('threshold','80');
INSERT INTO subjects(code,name) VALUES('DBMS','Database Management'),('OS','Operating Systems'),('CN','Computer Networks'),('SE','Software Engineering'),('DAA','Design and Analysis of Algorithms');
