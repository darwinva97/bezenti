package services

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"os"

	_ "github.com/go-sql-driver/mysql"
)

type DBCreds struct {
	Name     string
	User     string
	Password string
}

type Database struct{}

func (Database) CreateDatabase(username string) (DBCreds, error) {
	db, err := rootDB()
	if err != nil {
		return DBCreds{}, err
	}
	defer db.Close()

	dbName := username + "_db"
	dbUser := username
	password := randHex(16)

	// @localhost para la app PHP (socket) y @'%' para acceso externo por
	// internet — la seguridad es usuario+contraseña, no el hostname.
	stmts := []string{
		fmt.Sprintf("CREATE DATABASE IF NOT EXISTS `%s`", dbName),
		fmt.Sprintf("CREATE USER IF NOT EXISTS '%s'@'localhost' IDENTIFIED BY '%s'", dbUser, password),
		fmt.Sprintf("GRANT ALL PRIVILEGES ON `%s`.* TO '%s'@'localhost'", dbName, dbUser),
		fmt.Sprintf("CREATE USER IF NOT EXISTS '%s'@'%%' IDENTIFIED BY '%s'", dbUser, password),
		fmt.Sprintf("GRANT ALL PRIVILEGES ON `%s`.* TO '%s'@'%%'", dbName, dbUser),
		"FLUSH PRIVILEGES",
	}

	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return DBCreds{}, fmt.Errorf("db setup: %w", err)
		}
	}

	return DBCreds{Name: dbName, User: dbUser, Password: password}, nil
}

func (Database) DeleteDatabase(username string) {
	db, err := rootDB()
	if err != nil {
		return
	}
	defer db.Close()

	db.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS `%s_db`", username))
	db.Exec(fmt.Sprintf("DROP USER IF EXISTS '%s'@'localhost'", username))
	db.Exec(fmt.Sprintf("DROP USER IF EXISTS '%s'@'%%'", username))
	db.Exec("FLUSH PRIVILEGES")
}

func rootDB() (*sql.DB, error) {
	pass := os.Getenv("DB_ROOT_PASSWORD")
	dsn := fmt.Sprintf("root:%s@unix(/var/run/mysqld/mysqld.sock)/", pass)
	return sql.Open("mysql", dsn)
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}
