USE attendance_db;
CREATE TABLE IF NOT EXISTS corrections(id INT AUTO_INCREMENT PRIMARY KEY,student_id INT,session_id INT,claimed ENUM('P','L') DEFAULT 'P',
 reason VARCHAR(255),status ENUM('Pending','Approved','Rejected') DEFAULT 'Pending',decision_note VARCHAR(255) DEFAULT '',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notes(id INT AUTO_INCREMENT PRIMARY KEY,student_id INT,mentor_id INT,note VARCHAR(400),
 follow_up ENUM('Open','Done') DEFAULT 'Open',created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
