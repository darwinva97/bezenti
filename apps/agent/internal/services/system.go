package services

import (
	"fmt"
	"os/exec"
	"strings"
)

type System struct{}

func (System) CreateUser(username, password string, diskMB int) error {
	if err := run("useradd", "-m", "-d", "/var/www/"+username, "-s", "/usr/sbin/nologin", "-G", "sftp-clientes", username); err != nil {
		return fmt.Errorf("useradd: %w", err)
	}

	// set password via chpasswd
	cmd := exec.Command("chpasswd")
	cmd.Stdin = strings.NewReader(username + ":" + password)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("chpasswd: %w", err)
	}

	// create directory structure
	for _, dir := range []string{"public", "logs", "tmp"} {
		path := "/var/www/" + username + "/" + dir
		if err := run("mkdir", "-p", path); err != nil {
			return err
		}
		if err := run("chown", username+":"+username, path); err != nil {
			return err
		}
	}

	// chroot dir must be owned by root
	if err := run("chown", "root:root", "/var/www/"+username); err != nil {
		return err
	}

	return setQuota(username, diskMB)
}

func (System) DeleteUser(username string) error {
	run("userdel", "-r", username) //nolint — best effort
	return nil
}

func (System) UpdateQuota(username string, diskMB int) error {
	return setQuota(username, diskMB)
}

func setQuota(username string, diskMB int) error {
	blocks := diskMB * 1024 // 1 MB = 1024 blocks (1k)
	soft := fmt.Sprintf("%d", blocks)
	hard := fmt.Sprintf("%d", int(float64(blocks)*1.05)) // 5% grace
	return run("setquota", "-u", username, soft, hard, "0", "0", "/")
}

func run(name string, args ...string) error {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %s", name, out)
	}
	return nil
}
