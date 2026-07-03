<?
	include ("../db_connect.php");
	
	$id = $_GET['id'];	
	
	OpenConnection();
	
	$sql = "DELETE FROM bacheca_capitoli WHERE id = ".$id;
	
	$query = mysql_query($sql);	
	
	CloseConnection();		
	
	header("Location: gest_bacheca.php");
?>