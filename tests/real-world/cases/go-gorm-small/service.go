package main

import (
	"example.com/gorm-small/models"

	"gorm.io/gorm"
)

func FindUser(db *gorm.DB, id uint) (*models.User, error) {
	var user models.User
	err := db.Where("id = ?", id).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func CreateUser(db *gorm.DB, name string) error {
	return db.Create(&models.User{Name: name}).Error
}
