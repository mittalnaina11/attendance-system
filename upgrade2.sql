USE attendance_db;
CREATE TABLE IF NOT EXISTS checkins(id INT AUTO_INCREMENT PRIMARY KEY,code VARCHAR(8),session_id INT,expires_at DATETIME,INDEX(code),
 FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE);
