package services

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Files opera sobre el árbol de archivos de un cliente. Toda ruta que llega
// del exterior es relativa al home del cliente (/var/www/<linuxUser>) y se
// resuelve con ResolveUserPath — nada fuera de ese directorio es accesible.
type Files struct{}

var linuxUserRe = regexp.MustCompile(`^[a-z][a-z0-9_]{1,31}$`)

// ResolveUserPath valida el usuario y resuelve una ruta relativa dentro de su
// home. Rechaza traversal (.., symlink-escape se mitiga porque las operaciones
// no siguen symlinks al escribir) y usuarios sin home en /var/www.
func ResolveUserPath(username, rel string) (string, error) {
	if !linuxUserRe.MatchString(username) {
		return "", errors.New("usuario inválido")
	}
	base := "/var/www/" + username
	if info, err := os.Stat(base); err != nil || !info.IsDir() {
		return "", errors.New("el usuario no tiene directorio de archivos")
	}
	if strings.ContainsRune(rel, 0) {
		return "", errors.New("ruta inválida")
	}
	abs := filepath.Clean(filepath.Join(base, rel))
	if abs != base && !strings.HasPrefix(abs, base+"/") {
		return "", errors.New("ruta fuera del directorio del usuario")
	}
	return abs, nil
}

func userIDs(username string) (uid, gid int, err error) {
	u, err := user.Lookup(username)
	if err != nil {
		return 0, 0, fmt.Errorf("usuario %s no existe: %w", username, err)
	}
	uid, _ = strconv.Atoi(u.Uid)
	gid, _ = strconv.Atoi(u.Gid)
	return uid, gid, nil
}

type FileEntry struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Mtime   int64  `json:"mtime"`
	IsDir   bool   `json:"is_dir"`
	Mode    string `json:"mode"`    // permisos octales, ej. "644"
	Symlink bool   `json:"symlink"`
}

// List devuelve las entradas de un directorio (directorios primero, alfabético).
func (Files) List(username, rel string) ([]FileEntry, error) {
	abs, err := ResolveUserPath(username, rel)
	if err != nil {
		return nil, err
	}
	dirents, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	entries := make([]FileEntry, 0, len(dirents))
	for _, d := range dirents {
		info, err := d.Info()
		if err != nil {
			continue
		}
		e := FileEntry{
			Name:    d.Name(),
			Mtime:   info.ModTime().Unix(),
			Mode:    fmt.Sprintf("%o", info.Mode().Perm()),
			Symlink: info.Mode()&fs.ModeSymlink != 0,
		}
		// Para symlinks reportar el destino (si resuelve dentro del home)
		if e.Symlink {
			if target, err := os.Stat(filepath.Join(abs, d.Name())); err == nil {
				e.IsDir = target.IsDir()
				e.Size = target.Size()
			}
		} else {
			e.IsDir = d.IsDir()
			e.Size = info.Size()
		}
		entries = append(entries, e)
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDir != entries[j].IsDir {
			return entries[i].IsDir
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries, nil
}

// Open abre un archivo para lectura (download / editor) y devuelve su tamaño.
func (Files) Open(username, rel string) (*os.File, int64, error) {
	abs, err := ResolveUserPath(username, rel)
	if err != nil {
		return nil, 0, err
	}
	f, err := os.Open(abs)
	if err != nil {
		return nil, 0, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, 0, err
	}
	if info.IsDir() {
		f.Close()
		return nil, 0, errors.New("es un directorio")
	}
	return f, info.Size(), nil
}

// Write crea o sobreescribe un archivo con el contenido del reader y lo
// asigna al usuario. Crea directorios intermedios si no existen.
func (Files) Write(username, rel string, r io.Reader) (int64, error) {
	abs, err := ResolveUserPath(username, rel)
	if err != nil {
		return 0, err
	}
	uid, gid, err := userIDs(username)
	if err != nil {
		return 0, err
	}
	if err := mkdirAllOwned(filepath.Dir(abs), uid, gid); err != nil {
		return 0, err
	}
	f, err := os.OpenFile(abs, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return 0, err
	}
	n, err := io.Copy(f, r)
	f.Close()
	if err != nil {
		return n, err
	}
	return n, os.Chown(abs, uid, gid)
}

// Mkdir crea un directorio (con padres) propiedad del usuario.
func (Files) Mkdir(username, rel string) error {
	abs, err := ResolveUserPath(username, rel)
	if err != nil {
		return err
	}
	uid, gid, err := userIDs(username)
	if err != nil {
		return err
	}
	return mkdirAllOwned(abs, uid, gid)
}

// mkdirAllOwned es MkdirAll pero asignando cada directorio creado al usuario.
func mkdirAllOwned(abs string, uid, gid int) error {
	if info, err := os.Stat(abs); err == nil {
		if info.IsDir() {
			return nil
		}
		return errors.New("ya existe un archivo con ese nombre")
	}
	if err := mkdirAllOwned(filepath.Dir(abs), uid, gid); err != nil {
		return err
	}
	if err := os.Mkdir(abs, 0o755); err != nil && !errors.Is(err, fs.ErrExist) {
		return err
	}
	return os.Chown(abs, uid, gid)
}

// Rename mueve/renombra dentro del home del usuario. Falla si el destino existe.
func (Files) Rename(username, fromRel, toRel string) error {
	from, err := ResolveUserPath(username, fromRel)
	if err != nil {
		return err
	}
	to, err := ResolveUserPath(username, toRel)
	if err != nil {
		return err
	}
	if _, err := os.Lstat(to); err == nil {
		return errors.New("el destino ya existe")
	}
	return os.Rename(from, to)
}

// Copy copia un archivo o directorio (recursivo) dentro del home.
func (Files) Copy(username, fromRel, toRel string) error {
	from, err := ResolveUserPath(username, fromRel)
	if err != nil {
		return err
	}
	to, err := ResolveUserPath(username, toRel)
	if err != nil {
		return err
	}
	if to == from || strings.HasPrefix(to, from+"/") {
		return errors.New("no se puede copiar dentro de sí mismo")
	}
	if _, err := os.Lstat(to); err == nil {
		return errors.New("el destino ya existe")
	}
	uid, gid, err := userIDs(username)
	if err != nil {
		return err
	}
	return copyTree(from, to, uid, gid)
}

func copyTree(from, to string, uid, gid int) error {
	info, err := os.Lstat(from)
	if err != nil {
		return err
	}
	switch {
	case info.IsDir():
		if err := os.Mkdir(to, info.Mode().Perm()); err != nil {
			return err
		}
		if err := os.Chown(to, uid, gid); err != nil {
			return err
		}
		dirents, err := os.ReadDir(from)
		if err != nil {
			return err
		}
		for _, d := range dirents {
			if err := copyTree(filepath.Join(from, d.Name()), filepath.Join(to, d.Name()), uid, gid); err != nil {
				return err
			}
		}
		return nil
	case info.Mode()&fs.ModeSymlink != 0:
		target, err := os.Readlink(from)
		if err != nil {
			return err
		}
		if err := os.Symlink(target, to); err != nil {
			return err
		}
		return os.Lchown(to, uid, gid)
	default:
		src, err := os.Open(from)
		if err != nil {
			return err
		}
		defer src.Close()
		dst, err := os.OpenFile(to, os.O_CREATE|os.O_WRONLY|os.O_EXCL, info.Mode().Perm())
		if err != nil {
			return err
		}
		if _, err := io.Copy(dst, src); err != nil {
			dst.Close()
			return err
		}
		dst.Close()
		return os.Chown(to, uid, gid)
	}
}

// Delete elimina archivos/directorios (recursivo). El home mismo no se borra.
func (Files) Delete(username string, rels []string) error {
	base, err := ResolveUserPath(username, ".")
	if err != nil {
		return err
	}
	for _, rel := range rels {
		abs, err := ResolveUserPath(username, rel)
		if err != nil {
			return err
		}
		if abs == base {
			return errors.New("no se puede eliminar el directorio raíz")
		}
		if err := os.RemoveAll(abs); err != nil {
			return err
		}
	}
	return nil
}

// Chmod cambia permisos con un modo octal de 3 dígitos ("644", "755", …).
func (Files) Chmod(username, rel, mode string) error {
	abs, err := ResolveUserPath(username, rel)
	if err != nil {
		return err
	}
	parsed, err := strconv.ParseUint(mode, 8, 32)
	if err != nil || parsed > 0o777 {
		return errors.New("modo inválido (usa octal, ej. 644)")
	}
	return os.Chmod(abs, fs.FileMode(parsed))
}

// Extract descomprime un .zip, .tar.gz o .tgz en destRel (con protección
// zip-slip: toda entrada debe resolver dentro del destino).
func (Files) Extract(username, rel, destRel string) error {
	abs, err := ResolveUserPath(username, rel)
	if err != nil {
		return err
	}
	dest, err := ResolveUserPath(username, destRel)
	if err != nil {
		return err
	}
	uid, gid, err := userIDs(username)
	if err != nil {
		return err
	}
	if err := mkdirAllOwned(dest, uid, gid); err != nil {
		return err
	}
	lower := strings.ToLower(abs)
	switch {
	case strings.HasSuffix(lower, ".zip"):
		return extractZip(abs, dest, uid, gid)
	case strings.HasSuffix(lower, ".tar.gz"), strings.HasSuffix(lower, ".tgz"):
		return extractTarGz(abs, dest, uid, gid)
	default:
		return errors.New("formato no soportado (zip, tar.gz, tgz)")
	}
}

// safeJoin resuelve una entrada de archivo comprimido dentro de dest o falla.
func safeJoin(dest, name string) (string, error) {
	p := filepath.Clean(filepath.Join(dest, name))
	if p != dest && !strings.HasPrefix(p, dest+"/") {
		return "", fmt.Errorf("entrada insegura en el archivo: %s", name)
	}
	return p, nil
}

func extractZip(src, dest string, uid, gid int) error {
	zr, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, f := range zr.File {
		p, err := safeJoin(dest, f.Name)
		if err != nil {
			return err
		}
		if f.FileInfo().IsDir() {
			if err := mkdirAllOwned(p, uid, gid); err != nil {
				return err
			}
			continue
		}
		if err := mkdirAllOwned(filepath.Dir(p), uid, gid); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode().Perm()|0o600)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if err != nil {
			return err
		}
		if err := os.Chown(p, uid, gid); err != nil {
			return err
		}
	}
	return nil
}

func extractTarGz(src, dest string, uid, gid int) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		p, err := safeJoin(dest, hdr.Name)
		if err != nil {
			return err
		}
		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := mkdirAllOwned(p, uid, gid); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := mkdirAllOwned(filepath.Dir(p), uid, gid); err != nil {
				return err
			}
			out, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, fs.FileMode(hdr.Mode).Perm()|0o600)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil { //nolint:gosec — scoped al home del cliente
				out.Close()
				return err
			}
			out.Close()
			if err := os.Chown(p, uid, gid); err != nil {
				return err
			}
		default:
			// symlinks y otros tipos se omiten al extraer (evita escapes)
		}
	}
}

// Zip escribe un zip del archivo/directorio dado en el writer (descargas).
func (Files) Zip(username, rel string, w io.Writer) error {
	abs, err := ResolveUserPath(username, rel)
	if err != nil {
		return err
	}
	root := filepath.Dir(abs)
	zw := zip.NewWriter(w)
	defer zw.Close()
	return filepath.WalkDir(abs, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relName, _ := filepath.Rel(root, p)
		info, err := d.Info()
		if err != nil {
			return err
		}
		if d.IsDir() {
			_, err := zw.Create(relName + "/")
			return err
		}
		if !info.Mode().IsRegular() {
			return nil // symlinks fuera
		}
		hdr, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		hdr.Name = relName
		hdr.Method = zip.Deflate
		hdr.Modified = time.Unix(info.ModTime().Unix(), 0)
		out, err := zw.CreateHeader(hdr)
		if err != nil {
			return err
		}
		src, err := os.Open(p)
		if err != nil {
			return err
		}
		defer src.Close()
		_, err = io.Copy(out, src)
		return err
	})
}
